package system

import (
	"os"
	"strings"
)

const (
	dbusPath    = "/var/lib/dbus/machine-id"
	dbusPathEtc = "/etc/machine-id"
)

// GetID returns the machine ID specified at `/var/lib/dbus/machine-id` or `/etc/machine-id`.
// If there is an error reading the files an empty string is returned.
func GetID() (string, error) {
	id, err := os.ReadFile(dbusPath)
	if err != nil {
		id, err = os.ReadFile(dbusPathEtc)
	}
	if err != nil {
		return "", err
	}
	return strings.Trim(string(id), " \n"), nil
}
