package party

import (
	"context"
	"fmt"
	"nestri/maitred/pkg/resource"
	"net/url"
	"os"
	"os/signal"
	"syscall"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
)

func Run() {
	var topic = fmt.Sprintf("%s/%s/test", resource.Resource.App.Name, resource.Resource.App.Stage)
	var serverURL = fmt.Sprintf("wss://%s/mqtt?x-amz-customauthorizer-name=%s", resource.Resource.Party.Endpoint, resource.Resource.Party.Authorizer)
	var clientID = generateClientID()

	// App will run until cancelled by user (e.g. ctrl-c)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// We will connect to the Eclipse test server (note that you may see messages that other users publish)
	u, err := url.Parse(serverURL)
	if err != nil {
		panic(err)
	}

	router := paho.NewStandardRouter()
	router.DefaultHandler(func(p *paho.Publish) { fmt.Printf("default handler received message with topic: %s\n", p.Topic) })

	cliCfg := autopaho.ClientConfig{
		ServerUrls:      []*url.URL{u},
		ConnectUsername: "", // Must be empty for the authorizer
		ConnectPassword: []byte("PLACEHOLDER_PASSWORD"),
		KeepAlive:       20, // Keepalive message should be sent every 20 seconds
		// We don't want the broker to delete any session info when we disconnect
		CleanStartOnInitialConnection: true,
		SessionExpiryInterval:         0,
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			fmt.Println("mqtt connection up")
			if _, err := cm.Subscribe(context.Background(), &paho.Subscribe{
				Subscriptions: []paho.SubscribeOptions{
					{Topic: fmt.Sprintf("%s/#", topic), QoS: 1}, // For this example, we get all messages under test
				},
			}); err != nil {
				panic(fmt.Sprintf("failed to subscribe (%s). This is likely to mean no messages will be received.", err))
			}
		},
		OnConnectError: func(err error) { fmt.Printf("error whilst attempting connection: %s\n", err) },
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
			OnClientError: func(err error) { fmt.Printf("client error: %s\n", err) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				if d.Properties != nil {
					fmt.Printf("server requested disconnect: %s\n", d.Properties.ReasonString)
				} else {
					fmt.Printf("server requested disconnect; reason code: %d\n", d.ReasonCode)
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
	router.RegisterHandler(fmt.Sprintf("%s/test/test/#", topic), func(p *paho.Publish) { fmt.Printf("test/test/# received message with topic: %s\n", p.Topic) })
	router.RegisterHandler(fmt.Sprintf("%s/test/test/foo", topic), func(p *paho.Publish) { fmt.Printf("test/test/foo received message with topic: %s\n", p.Topic) })
	router.RegisterHandler(fmt.Sprintf("%s/nomatch", topic), func(p *paho.Publish) { fmt.Printf("test/nomatch received message with topic: %s\n", p.Topic) })
	router.RegisterHandler(fmt.Sprintf("%s/test/quit", topic), func(p *paho.Publish) { stop() }) // Context will be cancelled if we receive a matching message

	// We publish three messages to test out the various route handlers
	topics := []string{"test/test", "test/test/foo", "test/xxNoMatch", "test/quit"}
	for _, t := range topics {
		if _, err := c.Publish(ctx, &paho.Publish{
			QoS:     1,
			Topic:   fmt.Sprintf("%s/%s", topic, t),
			Payload: []byte("TestMessage on topic: " + t),
		}); err != nil {
			if ctx.Err() == nil {
				panic(err) // Publish will exit when context cancelled or if something went wrong
			}
		}
	}

	<-c.Done() // Wait for clean shutdown (cancelling the context triggered the shutdown)
}
