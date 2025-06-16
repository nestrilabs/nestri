package resource

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
)

type Resource struct {
	Api struct {
		Url string `json:"url"`
	}
	Auth struct {
		Url string `json:"url"`
	}
	/*AuthFingerprintKey struct {
		Value string `json:"value"`
	}*/
	Realtime struct {
		Endpoint   string `json:"endpoint"`
		Authorizer string `json:"authorizer"`
	}
	App struct {
		Name  string `json:"name"`
		Stage string `json:"stage"`
	}
}

func NewResource() (*Resource, error) {
	resource := Resource{}
	val := reflect.ValueOf(&resource).Elem()
	for i := 0; i < val.NumField(); i++ {
		field := val.Field(i)
		typeField := val.Type().Field(i)
		envVarName := fmt.Sprintf("SST_RESOURCE_%s", typeField.Name)
		envValue, exists := os.LookupEnv(envVarName)
		if !exists {
			return nil, fmt.Errorf("missing environment variable %s", envVarName)
		}
		if err := json.Unmarshal([]byte(envValue), field.Addr().Interface()); err != nil {
			return nil, fmt.Errorf("error unmarshalling %s: %w", envVarName, err)
		}
	}
	return &resource, nil
}
