package main

import (
	"nestri/maitred/internal/realtime"
)

func main() {
	realtime.Run()

	//TODO: On stop here, set the API as the instance is not running (stopped)
}
