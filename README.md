#WebIM
##Summary
This is the web-based IM(Instant Messager) server.

You can login to the WebIM by your own ID and password, then chat with
your friends in the browser. If your friends are online too, they will
get the words you just wrote immediately. If they are offline, they will
get your words next time they login.

##Implementation
WebIM is very simple, it's based on node.js as the web server, and redis
as the background storage.

Long Polling is used to keep active user get messages immediately. It's
hopeful pc and mobile browser can chat via WebIM.

##Installation
You should have node.js and redis installed correctly.

After download this project, initialize the redis database with sample data:

    $ cd webim
    $ ./initredis.sh

Note! this command will remove all data in your current redis database!

Then start WebIM:

    $ node app.js

now, open browser, access http://localhost:3000, login with ID 10001,
password 123456. In another browser, login with ID 10002, password 123456.
Then chat.


