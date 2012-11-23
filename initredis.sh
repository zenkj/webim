#!/bin/sh

redis-cli keys '*' | xargs redis-cli del

redis-cli hset user:10001 id                   10001
redis-cli hset user:10001 name                 foo
redis-cli hset user:10001 password             123456
redis-cli hset user:10001 next-msg-id          0
redis-cli hset user:10001 next-read-msg-index  0

redis-cli hset user:10002 id                   10002
redis-cli hset user:10002 name                 bar
redis-cli hset user:10002 password             123456
redis-cli hset user:10002 next-msg-id          0
redis-cli hset user:10002 next-read-msg-index  0

redis-cli rpush user:10001:friends 10002
redis-cli rpush user:10002:friends 10001
