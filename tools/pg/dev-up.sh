#!/usr/bin/env bash
docker rm -f sdp-pg 2>/dev/null
docker run -d --name sdp-pg -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=sdp_dashboard -p 5433:5432 postgres:16
echo "Postgres on localhost:5433 db=sdp_dashboard user=postgres pass=devpass"
