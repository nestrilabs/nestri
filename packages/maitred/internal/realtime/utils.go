package realtime

import (
	"crypto/rand"
	"fmt"
	"github.com/oklog/ulid/v2"
	"time"
)

func generateClientID() string {
	// Create a source of entropy (cryptographically secure)
	entropy := ulid.Monotonic(rand.Reader, 0)
	// Generate a new ULID
	id := ulid.MustNew(ulid.Timestamp(time.Now()), entropy)
	// Create the client ID string
	return fmt.Sprintf("mch_%s", id.String())
}
