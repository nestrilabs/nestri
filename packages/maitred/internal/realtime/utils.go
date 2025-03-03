package realtime

import (
	"fmt"
	"os"
	"time"

	"crypto/rand"

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
	// Create a source of entropy (cryptographically secure)
	entropy := ulid.Monotonic(rand.Reader, 0)

	// Generate a new ULID
	id := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)

	// Create the client ID string
	return fmt.Sprintf("mch_%s", id.String())
}
