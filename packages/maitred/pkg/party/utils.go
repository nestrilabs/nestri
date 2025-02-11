package party

import (
	"fmt"
	"os"
	"time"

	"math/rand"

	"github.com/charmbracelet/log"
	"github.com/oklog/ulid/v2"
)

var (
	infoLogger = log.NewWithOptions(os.Stderr, log.Options{
		ReportTimestamp: true,
		TimeFormat:      time.Kitchen,
		// Prefix:          "Realtime",
	})
)

func generateClientID() string {
	// Create a source of entropy (use cryptographically secure randomness in production)
	entropy := rand.New(rand.NewSource(time.Now().UnixNano()))

	// Generate a new ULID
	id := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)

	// Create the client ID string
	return fmt.Sprintf("client_%s", id.String())
}
