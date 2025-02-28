package realtime

import (
	"context"
	"fmt"
	"nestri/maitred/internal/auth"
	"nestri/maitred/internal/resource"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/charmbracelet/log"
	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
)

func Run() {
	//Use hostname as the last part of this URL
	hostname, err := os.Hostname()
	if err != nil {
		log.Fatal("Could not get the hostname")
	}
	// The explicitly set the machineID as the client ID
	var clientID = generateClientID()
	var topic = fmt.Sprintf("%s/%s/%s", resource.Resource.App.Name, resource.Resource.App.Stage, hostname)
	var serverURL = fmt.Sprintf("wss://%s/mqtt?x-amz-customauthorizer-name=%s", resource.Resource.Realtime.Endpoint, resource.Resource.Realtime.Authorizer)

	// App will run until cancelled by user (e.g. ctrl-c)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	userTokens, err := auth.FetchUserToken()
	if err != nil {
		log.Error("Error trying to request for credentials", "err", err)
		stop()
	}

	//Use the userTokens to query for the current taskID

	// We will connect to the Eclipse test server (note that you may see messages that other users publish)
	u, err := url.Parse(serverURL)
	if err != nil {
		panic(err)
	}

	router := paho.NewStandardRouter()
	router.DefaultHandler(func(p *paho.Publish) {
		infoLogger.Info("Router", "info", fmt.Sprintf("default handler received message with topic: %s\n", p.Topic))
	})

	cliCfg := autopaho.ClientConfig{
		ServerUrls:      []*url.URL{u},
		ConnectUsername: "", // Must be empty for the authorizer
		ConnectPassword: []byte(userTokens.AccessToken),
		KeepAlive:       20, // Keepalive message should be sent every 20 seconds
		// We don't want the broker to delete any session info when we disconnect
		CleanStartOnInitialConnection: true,
		SessionExpiryInterval:         60, // Session remains live 60 seconds after disconnect
		ReconnectBackoff:              autopaho.NewConstantBackoff(time.Second),
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			infoLogger.Info("Router", "info", "MQTT connection is up and running")
			if _, err := cm.Subscribe(context.Background(), &paho.Subscribe{
				Subscriptions: []paho.SubscribeOptions{
					{Topic: fmt.Sprintf("%s/#", topic), QoS: 1}, //Listen to all messages from this team
				},
			}); err != nil {
				panic(fmt.Sprintf("failed to subscribe (%s). This is likely to mean no messages will be received.", err))
			}
		},
		Errors: logger{prefix: "subscribe"},
		OnConnectError: func(err error) {
			infoLogger.Error("Router", "err", fmt.Sprintf("error whilst attempting connection: %s\n", err))
		},
		// eclipse/paho.golang/paho provides base mqtt functionality, the below config will be passed in for each connection
		ClientConfig: paho.ClientConfig{
			// If you are using QOS 1/2, then it's important to specify a client id (which must be unique)
			ClientID: clientID,
			// OnPublishReceived is a slice of functions that will be called when a message is received.
			// You can write the function(s) yourself or use the supplied Router
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					router.Route(pr.Packet.Packet())
					return true, nil // we assume that the router handles all messages (todo: amend router API)
				}},
			OnClientError: func(err error) { infoLogger.Error("Router", "err", fmt.Sprintf("client error: %s\n", err)) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				if d.Properties != nil {
					infoLogger.Info("Router", "info", fmt.Sprintf("server requested disconnect: %s\n", d.Properties.ReasonString))
				} else {
					infoLogger.Info("Router", "info", fmt.Sprintf("server requested disconnect; reason code: %d\n", d.ReasonCode))
				}
			},
		},
	}

	c, err := autopaho.NewConnection(ctx, cliCfg) // starts process; will reconnect until context cancelled
	if err != nil {
		panic(err)
	}

	if err = c.AwaitConnection(ctx); err != nil {
		panic(err)
	}

	// Handlers can be registered/deregistered at any time. It's important to note that you need to subscribe AND create
	// a handler
	//TODO: Have different routes for different things, like starting a session, stopping a session, and stopping the container altogether
	//TODO: Listen on team-slug/container-hostname topic only
	router.RegisterHandler(fmt.Sprintf("%s/%s/start", topic, hostname), func(p *paho.Publish) {
		infoLogger.Info("Router", "info", fmt.Sprintf("start a game: %s\n", p.Topic))
	})
	router.RegisterHandler(fmt.Sprintf("%s/%s/stop", topic, hostname), func(p *paho.Publish) { fmt.Printf("stop the game that is running: %s\n", p.Topic) })
	router.RegisterHandler(fmt.Sprintf("%s/%s/download", topic, hostname), func(p *paho.Publish) { fmt.Printf("download a game: %s\n", p.Topic) })
	router.RegisterHandler(fmt.Sprintf("%s/%s/quit", topic, hostname), func(p *paho.Publish) { stop() }) // Stop and quit this running container

	// We publish three messages to test out the various route handlers
	// topics := []string{"test/test", "test/test/foo", "test/xxNoMatch", "test/quit"}
	// for _, t := range topics {
	// 	if _, err := c.Publish(ctx, &paho.Publish{
	// 		QoS:     1,
	// 		Topic:   fmt.Sprintf("%s/%s", topic, t),
	// 		Payload: []byte("TestMessage on topic: " + t),
	// 	}); err != nil {
	// 		if ctx.Err() == nil {
	// 			panic(err) // Publish will exit when context cancelled or if something went wrong
	// 		}
	// 	}
	// }

	<-c.Done() // Wait for clean shutdown (cancelling the context triggered the shutdown)
}
