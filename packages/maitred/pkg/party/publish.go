package party

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/autopaho/queue"
	"github.com/eclipse/paho.golang/autopaho/queue/file"
	"github.com/eclipse/paho.golang/autopaho/queue/memory"
	"github.com/eclipse/paho.golang/paho"
)

// the Queue interface does not include WaitForEmpty because it's not needed in autopaho; however it's
// useful here, and both implementations used offer the function.
type queueWaitForEmpty interface {
	queue.Queue
	WaitForEmpty() chan struct{}
}

// publish connects to the server and publishes the requested number of messages
// The body of each message will be the Varint encoded message count (1 - msgCount)
func publish(ctx context.Context, serverURL *url.URL, msgCount uint64, topic string) {
	dropAt := make(map[uint64]bool)
	for _, i := range disconnectAtCount {
		dropAt[i] = true
	}

	var q queueWaitForEmpty
	var err error
	if useMemoryQueue {
		q = memory.New()
	} else {
		// Store queue files in the current folder (a bit messy but makes it obvious if any files are left behind)
		q, err = file.New("./", "queue", ".msg")
		if err != nil {
			panic(err)
		}
	}

	// Previous runs of the test may have left messages queued; remove them!
	for {
		entry, err := q.Peek()
		if errors.Is(err, queue.ErrEmpty) {
			break
		}
		if err != nil {
			panic(err)
		}
		if err := entry.Remove(); err != nil {
			panic(err)
		}
	}

	var ClientID = generateClientID()

	cliCfg := autopaho.ClientConfig{
		Queue:                         q,
		ServerUrls:                    []*url.URL{serverURL},
		KeepAlive:                     20,   // Keepalive message should be sent every 20 seconds
		CleanStartOnInitialConnection: true, // Previous tests should not contaminate this one!
		SessionExpiryInterval:         60,   // If connection drops we want session to remain live whilst we reconnect
		ConnectUsername:               "",   // Must be empty for the authorizer
		ConnectPassword:               []byte("PLACEHOLDER_PASSWORD"),
		OnConnectionUp: func(cm *autopaho.ConnectionManager, connAck *paho.Connack) {
			fmt.Println("publish: mqtt connection up")
		},
		OnConnectError: func(err error) { fmt.Printf("publish: error whilst attempting connection: %s\n", err) },
		Errors:         logger{prefix: "publish"},
		// Debug:          logger{prefix: "publish: debug"},
		PahoErrors: logger{prefix: "publishP"},
		// PahoDebug:      logger{prefix: "publishP: debug"},
		// eclipse/paho.golang/paho provides base mqtt functionality, the below config will be passed in for each connection
		ClientConfig: paho.ClientConfig{
			ClientID:      ClientID,
			OnClientError: func(err error) { fmt.Printf("publish: client error: %s\n", err) },
			OnServerDisconnect: func(d *paho.Disconnect) {
				if d.Properties != nil {
					fmt.Printf("publish: server requested disconnect: %s\n", d.Properties.ReasonString)
				} else {
					fmt.Printf("publish:server requested disconnect; reason code: %d\n", d.ReasonCode)
				}
			},
		},
	}

	c, err := autopaho.NewConnection(ctx, cliCfg)
	if err != nil {
		panic(err)
	}
	// We do not wait for the connection to come up; we just start publishing and allow autopaho to handle things
	for i := uint64(1); i <= msgCount; i++ {
		if dropAt[i] {
			c.TerminateConnectionForTest()
		}
		if err = c.PublishViaQueue(ctx, &autopaho.QueuePublish{
			Publish: &paho.Publish{
				QoS:     QOS,
				Topic:   topic,
				Payload: binary.AppendUvarint([]byte{}, i),
			}}); err != nil {
			panic(err)
		}

		// The queue relies on the file ModTime to work out what file is oldest; this means the resolution of
		// update times becomes important. To ensure order is maintained, we add a delay between calls to `publish`
		// (in real systems it's unlikely messages will be written more quickly).
		time.Sleep(time.Millisecond)

		if ctx.Err() != nil {
			fmt.Println("publish: Aborting due to context")
			return
		}
	}

	fmt.Println("publish: Messages queued")
	q.WaitForEmpty()
	fmt.Println("publish: Messages all sent or inflight")

	// There is no simple way for us to wait for the messages to be sent (i.e. waiting for QOS2 process to complete),
	// so, we just wait on the context
	<-ctx.Done()
	fmt.Println("publish: Context cancelled")
	<-c.Done()
	fmt.Println("publish: Clean Shutdown")
}
