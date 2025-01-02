package party

import (
	"fmt"
	"nestrilabs/cli/internal/machine"
	"net/url"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gorilla/websocket"
)

const (
	// Initial retry delay
	initialRetryDelay = 1 * time.Second
	// Maximum retry delay
	maxRetryDelay = 30 * time.Second
	// Factor to increase delay by after each attempt
	backoffFactor = 2
)

type Party struct {
	// Channel to signal shutdown
	done        chan struct{}
	fingerprint string
	hostname    string
}

func NewParty() *Party {
	m := machine.NewMachine()
	fingerpint := m.GetMachineID()
	return &Party{
		done:        make(chan struct{}),
		fingerprint: fingerpint,
		hostname:    m.Hostname,
	}
}

// Shutdown gracefully closes the connection
func (p *Party) Shutdown() {
	close(p.done)
}

func (p *Party) Connect() {
	baseURL := fmt.Sprintf("ws://localhost:1999/parties/main/%s", p.fingerprint)
	params := url.Values{}
	params.Add("_pk", p.hostname)
	wsURL := baseURL + "?" + params.Encode()

	retryDelay := initialRetryDelay

	for {
		select {
		case <-p.done:
			log.Info("Shutting down connection")
			return
		default:
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
			if err != nil {
				log.Error("Failed to connect to party server", "err", err)
				time.Sleep(retryDelay)
				// Increase retry delay exponentially, but cap it
				retryDelay = time.Duration(float64(retryDelay) * backoffFactor)
				if retryDelay > maxRetryDelay {
					retryDelay = maxRetryDelay
				}
				continue
			}

			// Reset retry delay on successful connection
			retryDelay = initialRetryDelay

			// Handle connection in a separate goroutine
			connectionClosed := make(chan struct{})
			go func() {
				defer close(connectionClosed)
				defer conn.Close()

				// Send initial message
				if err := conn.WriteMessage(websocket.TextMessage, []byte("hello there")); err != nil {
					log.Error("Failed to send initial message", "err", err)
					return
				}

				// Read messages loop
				for {
					select {
					case <-p.done:
						return
					default:
						_, message, err := conn.ReadMessage()
						if err != nil {
							log.Error("Error reading message", "err", err)
							return
						}
						log.Info("Received message from party server", "message", string(message))
					}
				}
			}()

			// Wait for either connection to close or shutdown signal
			select {
			case <-connectionClosed:
				log.Warn("Connection closed, attempting to reconnect...")
				time.Sleep(retryDelay)
			case <-p.done:
				log.Info("Shutting down connection")
				return
			}
		}
	}
}
