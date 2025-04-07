package realtime

import (
	"context"
	"fmt"
	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
	"log/slog"
	"nestri/maitred/internal/auth"
	"nestri/maitred/internal/containers"
	"nestri/maitred/internal/resource"
	"net/url"
	"os"
	"time"
)

func Run(ctx context.Context, machineID string, containerEngine containers.ContainerEngine, resource *resource.Resource) error {
	var clientID = generateClientID()
	var topic = fmt.Sprintf("%s/%s/%s", resource.App.Name, resource.App.Stage, machineID)
	var serverURL = fmt.Sprintf("wss://%s/mqtt?x-amz-customauthorizer-name=%s", resource.Realtime.Endpoint, resource.Realtime.Authorizer)

	slog.Info("Realtime", "topic", topic)

	userTokens, err := auth.FetchUserToken(machineID, resource)
	if err != nil {
		return err
	}

	slog.Info("Realtime", "token", userTokens.AccessToken)

	u, err := url.Parse(serverURL)
	if err != nil {
		return err
	}

	router := paho.NewStandardRouter()
	router.DefaultHandler(func(p *paho.Publish) {
		slog.Debug("DefaultHandler", "topic", p.Topic, "message", fmt.Sprintf("default handler received message: %s - with topic: %s", p.Payload, p.Topic))
	})

	createTopic := fmt.Sprintf("%s/create", topic)
	slog.Debug("Registering handler", "topic", createTopic)
	router.RegisterHandler(createTopic, func(p *paho.Publish) {
		slog.Debug("Router", "message", "received create message with payload", fmt.Sprintf("%s", p.Payload))

		base, _, err := ParseMessage(p.Payload)
		if err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to parse message: %s", err))
			return
		}

		if base.Type != "create" {
			slog.Error("Router", "err", "unexpected message type")
			return
		}

		// Create runner container
		containerID, err := CreateRunner(ctx, containerEngine)
		if err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to create runner container: %s", err))
			return
		}

		slog.Info("Router", "info", fmt.Sprintf("created runner container: %s", containerID))
	})

	startTopic := fmt.Sprintf("%s/start", topic)
	slog.Debug("Registering handler", "topic", startTopic)
	router.RegisterHandler(startTopic, func(p *paho.Publish) {
		slog.Debug("Router", "message", "received start message with payload", fmt.Sprintf("%s", p.Payload))

		base, payload, err := ParseMessage(p.Payload)
		if err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to parse message: %s", err))
			return
		}

		if base.Type != "start" {
			slog.Error("Router", "err", "unexpected message type")
			return
		}

		// Get container ID
		startPayload, ok := payload.(StartPayload)
		if !ok {
			slog.Error("Router", "err", "failed to get payload")
			return
		}

		// Start runner container
		if err = containerEngine.StartContainer(ctx, startPayload.ContainerID); err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to start runner container: %s", err))
			return
		}

		slog.Info("Router", "info", fmt.Sprintf("started runner container: %s", startPayload.ContainerID))
	})

	stopTopic := fmt.Sprintf("%s/stop", topic)
	slog.Debug("Registering handler", "topic", stopTopic)
	router.RegisterHandler(stopTopic, func(p *paho.Publish) {
		slog.Debug("Router", "message", "received stop message with payload", fmt.Sprintf("%s", p.Payload))

		base, payload, err := ParseMessage(p.Payload)
		if err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to parse message: %s", err))
			return
		}

		if base.Type != "stop" {
			slog.Error("Router", "err", "unexpected message type")
			return
		}

		// Get container ID
		stopPayload, ok := payload.(StopPayload)
		if !ok {
			slog.Error("Router", "err", "failed to get payload")
			return
		}

		// Stop runner container
		if err = containerEngine.StopContainer(ctx, stopPayload.ContainerID); err != nil {
			slog.Error("Router", "err", fmt.Sprintf("failed to stop runner container: %s", err))
			return
		}

		slog.Info("Router", "info", fmt.Sprintf("stopped runner container: %s", stopPayload.ContainerID))
	})

	legacyLogger := slog.NewLogLogger(slog.NewTextHandler(os.Stdout, nil), slog.LevelError)
	cliCfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{u},
		ConnectUsername:               "",
		ConnectPassword:               []byte(userTokens.AccessToken),
		KeepAlive:                     20,
		CleanStartOnInitialConnection: true,
		SessionExpiryInterval:         60,
		ReconnectBackoff:              autopaho.NewConstantBackoff(time.Second),
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			slog.Info("Router", "info", "MQTT connection is up and running")
			if _, err = cm.Subscribe(context.Background(), &paho.Subscribe{
				Subscriptions: []paho.SubscribeOptions{
					{Topic: fmt.Sprintf("%s/#", topic), QoS: 1},
				},
			}); err != nil {
				slog.Error("Router", "err", fmt.Sprint("failed to subscribe, likely no messages will be received: ", err))
			}
		},
		Errors: legacyLogger,
		OnConnectError: func(err error) {
			slog.Error("Router", "err", fmt.Sprintf("error whilst attempting connection: %s", err))
		},
		ClientConfig: paho.ClientConfig{
			ClientID: clientID,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					router.Route(pr.Packet.Packet())
					return true, nil
				}},
			OnClientError: func(err error) { slog.Error("Router", "err", fmt.Sprintf("client error: %s", err)) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				if d.Properties != nil {
					slog.Info("Router", "info", fmt.Sprintf("server requested disconnect: %s", d.Properties.ReasonString))
				} else {
					slog.Info("Router", "info", fmt.Sprintf("server requested disconnect; reason code: %d", d.ReasonCode))
				}
			},
		},
	}

	c, err := autopaho.NewConnection(ctx, cliCfg)
	if err != nil {
		return err
	}

	if err = c.AwaitConnection(ctx); err != nil {
		return err
	}

	return nil
}
