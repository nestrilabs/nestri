package party

import (
	"context"
	"fmt"
	"nestri/maitred/pkg/resource"
	"net/url"
	"os"
	"os/signal"
	"syscall"
)

// const serverURL = "mqtt://127.0.0.1:1883"
// const testTopic = "testTopic" // We publish all messages to the same topic because the server should maintain message order
const msgCount = 10000
const NotifyEvery = 100
const timeoutSecs = 60
const QOS = 1
const useMemoryQueue = false

var disconnectAtCount = []uint64{5} // The connection will be dropped before publishing the message # in this slice

func Run() {
	var topic = fmt.Sprintf("%s/%s/test", resource.Resource.App.Name, resource.Resource.App.Stage)
	var serverURL = fmt.Sprintf("wss://%s/mqtt?x-amz-customauthorizer-name=%s", resource.Resource.Party.Endpoint, resource.Resource.Party.Authorizer)

	fmt.Println("Topic:", topic)
	fmt.Println("ServerURL:", serverURL)
	// App will run until cancelled by user (e.g. ctrl-c)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Use a local server (a simple way to provide this is to use the docker example i.e. `docker compose up mosquitto`)
	u, err := url.Parse(serverURL)
	if err != nil {
		panic(err)
	}

	subReady := make(chan struct{})
	subComplete := make(chan struct{})
	go func() {
		defer close(subComplete)
		subscribe(ctx, u, msgCount, topic, subReady)
		stop() // All done so close things down
	}()
	select {
	case <-subReady: // Wait for subscribe to connect/subscribe
	case <-ctx.Done():
		fmt.Println("signal caught - exiting")
		return
	}

	publish(ctx, u, msgCount, topic)

	fmt.Println("messages published") // Note that messages may not have been transmitted to server at this point

	<-ctx.Done() // Wait for user to trigger exit
	fmt.Println("signal caught - exiting")
}
