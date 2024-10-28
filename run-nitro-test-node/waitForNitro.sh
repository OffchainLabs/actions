# poll the nitro endpoint until we get a 0 return code

PORT=${1:-8547}

# timeout after around 10 minutes
for i in {1..60}
do
  curl --silent -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":45678,"method":"eth_chainId","params":[]}' "http://localhost:$PORT"
  if [ "$?" -eq "0" ]; then
    echo "nitro ready at port $PORT"
    exit 0
  else
    echo "nitro not ready yet at port $PORT"
    sleep 10
  fi
done
echo "exiting: printing docker logs"
docker compose -f ./nitro-testnode/docker-compose.yaml logs
exit 1
