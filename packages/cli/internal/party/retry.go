package party

import (
	"encoding/json"
	"fmt"
	"nestrilabs/cli/internal/machine"
	"net/url"
	"os"
	"time"

	"github.com/charmbracelet/log"
	"github.com/gorilla/websocket"
)

// RetryConfig holds configuration for retry behavior
type RetryConfig struct {
	InitialDelay  time.Duration
	MaxDelay      time.Duration
	BackoffFactor float64
	MaxAttempts   int // use 0 for infinite retries
}

// DefaultRetryConfig provides sensible default values
var DefaultRetryConfig = RetryConfig{
	InitialDelay:  time.Second,
	MaxDelay:      30 * time.Second,
	BackoffFactor: 2.0,
	MaxAttempts:   0, // infinite retries
}

// RetryFunc is a function that will be retried
type RetryFunc[T any] func() (T, error)

// Retry executes the given function with retries based on the config
func Retry[T any](config RetryConfig, operation RetryFunc[T]) (T, error) {
	var result T
	currentDelay := config.InitialDelay
	attempts := 0

	for {
		if config.MaxAttempts > 0 && attempts >= config.MaxAttempts {
			return result, fmt.Errorf("max retry attempts (%d) exceeded", config.MaxAttempts)
		}

		result, err := operation()
		if err == nil {
			return result, nil
		}

		log.Warn("Operation failed, retrying...",
			"attempt", attempts+1,
			"delay", currentDelay,
			"error", err)

		time.Sleep(currentDelay)

		// Increase delay for next attempt
		currentDelay = time.Duration(float64(currentDelay) * config.BackoffFactor)
		if currentDelay > config.MaxDelay {
			currentDelay = config.MaxDelay
		}

		attempts++
	}
}

// MessageHandler processes a message and returns true if it's the expected type
type MessageHandler[T any] func(msg T) bool

type TypeListener[T any] struct {
	retryConfig RetryConfig
	handler     MessageHandler[T]
	fingerprint string
	hostname    string
}

func NewTypeListener[T any](handler MessageHandler[T]) *TypeListener[T] {
	m := machine.NewMachine()

	hostname, err := m.StaticHostname()
	if err != nil {
		log.Error("Failed to get the Machine's Hostname", "err", err)
		os.Exit(1)
	}

	fingerprint, err := m.MachineID()
	if err != nil {
		log.Error("Failed to get the Machine's ID", "err", err)
		os.Exit(1)
	}

	return &TypeListener[T]{
		retryConfig: DefaultRetryConfig,
		handler:     handler,
		fingerprint: fingerprint,
		hostname:    hostname,
	}
}

// SetRetryConfig allows customizing the retry behavior
func (t *TypeListener[T]) SetRetryConfig(config RetryConfig) {
	t.retryConfig = config
}

func (t *TypeListener[T]) ConnectUntilMessage() (T, error) {
	baseURL := fmt.Sprintf("ws://localhost:1999/parties/main/%s", t.fingerprint)
	params := url.Values{}
	params.Add("_pk", t.hostname)
	wsURL := baseURL + "?" + params.Encode()

	return Retry(t.retryConfig, func() (T, error) {
		var result T

		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			return result, fmt.Errorf("connection failed: %w", err)
		}
		defer conn.Close()

		// Read messages until we get the one we want
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				return result, fmt.Errorf("read error: %w", err)
			}

			if err := json.Unmarshal(message, &result); err != nil {
				// log.Error("Failed to unmarshal message", "err", err)
				continue
			}

			if t.handler(result) {
				return result, nil
			}
		}
	})
}
