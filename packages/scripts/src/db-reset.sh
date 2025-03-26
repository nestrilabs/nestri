#!/bin/bash

database=$(echo $SST_RESOURCE_Postgres | jq -r '.database')
clusterArn=$(echo $SST_RESOURCE_Postgres | jq -r '.clusterArn')
secretArn=$(echo $SST_RESOURCE_Postgres | jq -r '.secretArn')

sql=$(cat <<-'STMT'
DO $$
DECLARE
  row record;
BEGIN
    FOR row IN SELECT * FROM pg_tables WHERE schemaname = 'public' OR schemaname = 'drizzle'
    LOOP
      EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(row.tablename) || ' CASCADE';
      EXECUTE 'DROP TABLE IF EXISTS drizzle.' || quote_ident(row.tablename) || ' CASCADE';
    END LOOP;
END;
$$;
STMT
)

response=$(aws rds-data execute-statement --resource-arn $clusterArn --secret-arn $secretArn --database $database --sql "$sql" --format-records-as JSON)
json=$(echo $response | jq -r '.formattedRecords')
echo "$json" | jq .
