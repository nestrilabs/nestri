package auth

import (
	"fmt"
	"io"
	"nestrilabs/cli/internal/machine"
	"nestrilabs/cli/internal/resource"
	"net/http"
	"net/url"
	"os"

	"github.com/charmbracelet/log"
)

type UserCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func FetchUserCredentials(code string) {
	data := url.Values{}
	m := machine.NewMachine()

	hostname, err := m.StaticHostname()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}

	fingerprint, err := m.MachineID()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}

	redirect := fmt.Sprintf("http://localhost:1999/parties/main/%s/auth/%s", fingerprint, hostname)

	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("redirect_url", redirect)
	data.Set("auth_type", "verify")
	data.Set("code", code)
	resp, err := http.PostForm(resource.Resource.Auth.Url+"/device/callback", data)

	if err != nil {
		log.Error("Error trying to request a login url", "err", err)
		os.Exit(1)
	}

	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Error("Error trying to request a login url", "err", string(body))
		os.Exit(1)
	}

	body, _ := io.ReadAll(resp.Body)

	log.Info("Body recieved", "info", string(body))
}

func FetchUserUrl() string {
	data := url.Values{}
	m := machine.NewMachine()

	hostname, err := m.StaticHostname()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}

	fingerprint, err := m.MachineID()
	if err != nil {
		log.Error("Failed to start the cmd", "err", err)
		os.Exit(1)
	}

	redirect := fmt.Sprintf("http://localhost:1999/parties/main/%s/auth/%s", fingerprint, hostname)
	data.Set("client_secret", resource.Resource.AuthFingerprintKey.Value)
	data.Set("redirect_url", redirect)
	data.Set("auth_type", "request")
	resp, err := http.PostForm(resource.Resource.Auth.Url+"/device/callback", data)
	if err != nil {
		log.Error("Error trying to request a login url", "err", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Error("Error trying to request a login url", "err", string(body))
		os.Exit(1)
	}
	body, _ := io.ReadAll(resp.Body)

	return string(body)
}
