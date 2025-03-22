#!/bin/bash

database=$(echo $SST_RESOURCE_Postgres | jq -r '.database')
clusterArn=$(echo $SST_RESOURCE_Postgres | jq -r '.clusterArn')
secretArn=$(echo $SST_RESOURCE_Postgres | jq -r '.secretArn')

sql="$@"
response=$(aws rds-data execute-statement --resource-arn $clusterArn --secret-arn $secretArn --database $database --sql "$sql" --format-records-as JSON)
json=$(echo $response | jq -r '.formattedRecords')
echo "$json" | jq .