package resource

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
)

type resource struct {
	Api struct {
		Url string `json:"url"`
	}
	Auth struct {
		Url string `json:"url"`
	}
	AuthFingerprintKey struct {
		Value string `json:"value"`
	}
	Party struct {
		Endpoint   string `json:"endpoint"`
		Authorizer string `json:"authorizer"`
	}
	App struct {
		Name  string `json:"name"`
		Stage string `json:"stage"`
	}
}

var Resource resource

func init() {
	val := reflect.ValueOf(&Resource).Elem()
	for i := 0; i < val.NumField(); i++ {
		field := val.Field(i)
		typeField := val.Type().Field(i)
		envVarName := fmt.Sprintf("SST_RESOURCE_%s", typeField.Name)
		envValue, exists := os.LookupEnv(envVarName)
		if !exists {
			panic(fmt.Sprintf("Environment variable %s is required", envVarName))
		}
		if err := json.Unmarshal([]byte(envValue), field.Addr().Interface()); err != nil {
			panic(err)
		}
	}
}
