package party

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"net/url"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
)

// subscribe connects to the server and subscribes to the test topic. It then expects to receive
// msgCount messages each containing the varint encoded message count.
// Generally messages should be received once and in order, but this is only guaranteed where the message number is even
// (because publish uses QOS2 for those).
// ready will be closed when we are ready to receive messages
// Exists when all expected messages have been received
func subscribe(ctx context.Context, serverURL *url.URL, msgCount uint64, topic string, ready chan struct{}) {
	var msgRcvCount uint64
	msgReceived := make(map[uint64]bool, msgCount)
	allReceived := make(chan struct{})
	var ClientID = generateClientID()

	ping := make(chan uint64)
	cliCfg := autopaho.ClientConfig{
		ServerUrls:                    []*url.URL{serverURL},
		ConnectUsername:               "", // Must be empty for the authorizer
		ConnectPassword:               []byte("PLACEHOLDER_PASSWORD"),
		KeepAlive:                     20,   // Keepalive message should be sent every 20 seconds
		CleanStartOnInitialConnection: true, // Previous tests should not contaminate this one!
		SessionExpiryInterval:         60,   // If connection drops we want session to remain live whilst we reconnect
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			fmt.Println("mqtt connection up")
			if _, err := cm.Subscribe(ctx, &paho.Subscribe{
				Subscriptions: []paho.SubscribeOptions{
					{Topic: topic, QoS: QOS},
				},
			}); err != nil {
				fmt.Printf("subscribe: failed to subscribe (%s). Probably due to connection drop so will retry\n", err)
				return // likely connection has dropped
			}
			fmt.Println("subscribe: mqtt subscription made")
			if ready != nil {
				close(ready)
				ready = nil
			}
		},
		OnConnectError: func(err error) { fmt.Printf("subscribe: error whilst attempting connection: %s\n", err) },
		Errors:         logger{prefix: "subscribe"},
		// eclipse/paho.golang/paho provides base mqtt functionality, the below config will be passed in for each connection
		ClientConfig: paho.ClientConfig{
			ClientID: ClientID,
			OnPublishReceived: []func(paho.PublishReceived) (bool, error){
				func(pr paho.PublishReceived) (bool, error) {
					msgNo, err := binary.ReadUvarint(bytes.NewReader(pr.Packet.Payload))
					if err != nil {
						panic(err) // Message corruption or something else is using our topic!
					}
					// pubQos := msgNo%2 + 1

					newMessage := false

					if QOS == 1 {
						// Messages may be received out of order as pub/sub at QOS1 meaning we may receive multiple copies
						if !msgReceived[msgNo] {
							newMessage = true
						}
					} else {
						// Messages should always be in order and received once
						if msgReceived[msgNo] {
							panic(fmt.Sprintf("subscribe: message # %d already received", msgNo))
						}
						newMessage = true
					}
					if newMessage {
						msgReceived[msgNo] = true
						msgRcvCount++

						// We test that messages are received in the expected order (ordered delivery per topic is
						// required by the MQTT v5 spec)
						// if msgNo > 1 && !msgReceived[msgNo-1] {
						// 	panic(fmt.Sprintf("subscribe: message # %d received but we don't have previous QOS2 msg", msgNo))
						// }
						// if msgReceived[msgNo+1] {
						// 	panic(fmt.Sprintf("subscribe: message # %d received but we have already received next QOS2 msg ", msgNo))
						// }

						ping <- msgRcvCount
						if msgRcvCount%NotifyEvery == 0 {
							fmt.Printf("subscribe: received %d messages\n", msgRcvCount)
						}
						if msgRcvCount == msgCount {
							close(allReceived)
						}
					}
					return true, nil
				}},
			OnClientError: func(err error) { fmt.Printf("subscribe: client error: %s\n", err) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				if d.Properties != nil {
					fmt.Printf("subscribe: server requested disconnect: %s\n", d.Properties.ReasonString)
				} else {
					fmt.Printf("subscribe:server requested disconnect; reason code: %d\n", d.ReasonCode)
				}
			},
		},
	}

	c, err := autopaho.NewConnection(ctx, cliCfg)
	if err != nil {
		panic(err)
	}

	// Ensure that program will always exit (even if we don't get all messages expected)
	lastMsgTime := time.Now()
	tick := time.NewTicker(timeoutSecs * time.Second)
	defer tick.Stop()

waitLoop:
	for {
		select {
		case <-ctx.Done():
			err = ctx.Err()
			break waitLoop
		case <-allReceived:
			break waitLoop
		case <-ping:
			lastMsgTime = time.Now()
			continue
		case <-tick.C:
			if time.Since(lastMsgTime) > timeoutSecs*time.Second {
				var missing []uint64
				for i := uint64(1); i <= msgCount; i++ {
					if !msgReceived[i] {
						missing = append(missing, i)
					}
				}
				fmt.Printf("subscribe: Aborting because no messages received (received %d unique messages - missing %v)\n", msgRcvCount, missing)
				break waitLoop
			}
		}
	}

	if err != nil {
		fmt.Println("subscribe: Aborting due to: ", err)
		return
	}

	fmt.Println("subscribe: All received, disconnecting")
	if err = c.Disconnect(context.Background()); err != nil {
		panic(err)
	}
	<-c.Done()
	fmt.Println("subscribe: Done")
}
