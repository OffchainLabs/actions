# poll the token bridge deployment file until we get a 0 return code
while true
do
  docker-compose -f ./nitro-testnode/docker-compose.yaml run --entrypoint sh tokenbridge -c "if [ -f localNetwork.json ]; then cat localNetwork.json; else cat network.json; fi"
  if [ "$?" -eq "0" ]; then
    exit 0
  else
    sleep 10
  fi
done
