package relay

import (
	"errors"
	"net/http"
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
	done      chan struct{}
	name      string
	publicIP  string
	privateIP *string
}

func NewParty(name string, publicIP string, privateIP *string) (*Party, error) {
	if publicIP == "" {
		return nil, errors.New("No public ip was provided")
	}

	if name == "" {
		return nil, errors.New("No name was provided")
	}

	return &Party{
		done:      make(chan struct{}),
		name:      name,
		publicIP:  publicIP,
		privateIP: privateIP,
	}, nil
}

// Shutdown gracefully closes the connection
func (p *Party) Shutdown() {
	close(p.done)
}

func (p *Party) Connect() error {
	baseURL := "ws://localhost:1999/parties/relay/all"
	params := url.Values{}
	params.Add("_pk", p.name)
	wsURL := baseURL + "?" + params.Encode()

	retryDelay := initialRetryDelay
	header := http.Header{}
	// bearer := fmt.Sprintf("Bearer %s", resource.Resource.AuthFingerprintKey.Value)
	// header.Add("Authorization", bearer)

	for {
		select {
		case <-p.done:
			log.Info("Shutting down connection")
			return nil
		default:
			conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
			log.Info("Connection to server", "url", wsURL)

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
				return nil
			}
		}
	}
}
