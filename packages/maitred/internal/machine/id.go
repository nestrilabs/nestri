package machine

const (
	// dbusPath is the default path for dbus machine id.
	dbusPath = "/var/lib/dbus/machine-id"
	// dbusPathEtc is the default path for dbus machine id located in /etc.
	// Some systems (like Fedora 20) only know this path.
	// Sometimes it's the other way round.
	dbusPathEtc = "/etc/machine-id"
)

// machineID returns the uuid specified at `/var/lib/dbus/machine-id` or `/etc/machine-id`.
// If there is an error reading the files an empty string is returned.
// See https://unix.stackexchange.com/questions/144812/generate-consistent-machine-unique-id
func MachineID() (string, error) {
	// FIXME: Should we encode this cryptographically (or whatever they call it)
	// Could this be a security loophole???
	id, err := readFile(dbusPath)
	if err != nil {
		// try fallback path
		id, err = readFile(dbusPathEtc)
	}
	if err != nil {
		return "", err
	}
	return trim(string(id)), nil
}
