# poll the token bridge deployment file until we get a 0 return code
# timeout after around 10 minutes
for i in {1..60}
do
  docker compose -f ./nitro-testnode/docker-compose.yaml run --entrypoint sh tokenbridge -c "cat $1"
  if [ "$?" -eq "0" ]; then
    exit 0
  else
    echo "token bridge not ready yet $1"
    sleep 10
  fi
done
echo "exiting: printing docker logs"
docker compose -f ./nitro-testnode/docker-compose.yaml logs tokenbridge
exit 1
