package party

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/charmbracelet/log"
	"github.com/gorilla/websocket"
)

type Party struct{}

func NewParty() *Party {
	return &Party{}
}

func (p *Party) Connect(fingerprint string, hostname string) {
	baseURL := fmt.Sprintf("ws://localhost:1999/parties/main/%s", fingerprint) //[:7])

	params := url.Values{}
	params.Add("_pk", cleanString(hostname))

	wsURL := baseURL + "?" + params.Encode()
	log.Info("Connecting to party url", "url", wsURL)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Fatal("Error dialing the party url", "err", err)
	}
	defer conn.Close()

	// Send message
	err = conn.WriteMessage(websocket.TextMessage, []byte("hello there 2"))
	if err != nil {
		log.Error("Error trying to write to our party", "err", err)
		return
	}

	// Read messages
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Error("Error while trying to read message", "err", err)
			return
		}
		log.Info("Received message from party server", "message", string(message))
	}

}

func cleanString(s string) string {
	// 1. Lowercase the string
	s = strings.ToLower(s)

	// 2. Use a regular expression to remove non-alphanumeric characters
	reg := regexp.MustCompile("[^a-z0-9]+") // Matches one or more non-alphanumeric characters
	return reg.ReplaceAllString(s, "")
}
