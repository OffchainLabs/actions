# poll the token bridge deployment file until we get a 0 return code
while true
do
  docker compose -f ./nitro-testnode/docker-compose.yaml run --entrypoint sh tokenbridge -c "echo 'tokenbridge up';"
  if [ "$?" -eq "tokenbridge up" ]; then
    exit 0
  else
    sleep 10
  fi
done
