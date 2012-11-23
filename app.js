
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , http = require('http')
  , redis = require('redis').createClient()
  , util = require('./util')
  , path = require('path');

var app = express();

// all active users
var activeUsers = {};
//activeUsers[userid] = {name: name; sessionid: sessionid};

// all active sessions
var activeSessions = {};
//activeSessions[sessionid] = {userid:userid, cmdres: cmdres};

// period timer(every 1 seconds) to check all active sessions
var sessionCheckTimerID = setInterval(function() {
  for (var sessionid in activeSessions) {
    var session = activeSessions[sessionid];

    session.heartbeat ++;
    
    if (session.heartbeat % 10 == 0) {
      // when this session idles for every 10 seconds, let client responds me
      sendcmd(session, {cmd:'goon'});
    }

    if (session.heartbeat > 30) {
      // this session idles for more than 30 seconds, and
      // it does not respond me for 3 times, i think it's dead, remove it
      removeActiveSession(sessionid);
    }
  }
}, 1000);


function activeUser(sessionid) {
  var session = activeSessions[sessionid];
  if (session)
    return activeUsers[session.userid];
  return null;
}

function activeSession(userid) {
  var user = activeUsers[userid];
  if (user) return activeSessions[user.sessionid];
  return null;
}

function isActiveUser(userid) {
  if (!userid) return false;
  if (!activeUsers[userid]) return false;
  return true;
}
function isActiveSession(sessionid) {
  if (!sessionid)
    return false;
  if (!activeSessions[sessionid]) return false;
  return true;
}

function removeActiveSession(sessionid) {
  var session = activeSessions[sessionid];
  if (session) {
    delete activeSessions[sessionid];
    sendcmd(session, {cmd:'stop'});
    var user = activeUsers[session.userid];
    if (user) {
      delete activeUsers[session.userid];
    }
  }
}
    
function addActiveSession(userid, sessionid) {
  if (activeUsers[userid]) {
    var user = activeUsers[userid];
    if (sessionid == user.sessionid)
      return;
    var oldsession = activeSessions[user.sessionid];
    sendcmd(oldsession, {cmd:'relogin'});
    delete activeSessions[user.sessionid];

    user.sessionid = sessionid;
    activeSessions[sessionid] = {id:sessionid, userid: userid, heartbeat: 0};
    return;
  }

  redis.hget(userkey(userid), 'name', function(err, reply) {
    if (!err && reply) {
      activeUsers[userid] = {id:userid, name:reply, sessionid:sessionid};
      activeSessions[sessionid] = {id:sessionid, userid: userid, heartbeat: 0};
    }
  });
}

function setCommandResponse(sessionid, res) {
  var session = activeSessions[sessionid];
  if (!session) return;
  session.cmdres = res;
}

function clearHeartbeat(sessionid) {
  var session = activeSessions[sessionid];
  if (!session) return;
  session.heartbeat = 0;
}

// send command to the active client
function sendcmd(session, cmd) {
  console.log("prepare to send cmd: ");
  console.log(cmd);
  if (session && session.cmdres && !session.cmdres.finished) {
    sendres(session.cmdres, cmd);
    session.cmdres = undefined;
    console.log("sent cmd");
  }
}

function sendres(res, cmd) {
  var str = JSON.stringify(cmd);
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.end(str);
}

// forward user <userid>'s unread messages from its queue to its active client
function forwardmsg(userid) {
  console.log('forward msg for user ' + userid);
  var session = activeSession(userid);
  if (session && session.cmdres && !session.cmdres.finished) {
    var msgs = [];
    
    redis.hget(userkey(userid), 'next-read-msg-index', function(err, reply) {
      if (err) return;
      var nextReadMsgIndex = parseInt(reply);
      redis.llen(mqkey(userid), function(err, reply) {
        if (err) return;
        var mqLen = reply;
        var unread = mqLen - nextReadMsgIndex;
        if (unread > 0) {
          // so each http response contents 50 messages at most
          unread = unread > 50 ? 50 : unread;
          var rleft = nextReadMsgIndex;
          // redis lrange is inclusive at two edge[left,right], so minus 1
          var rright = nextReadMsgIndex + unread - 1;
          redis.lrange(mqkey(userid), rleft, rright, function(err, reply) {
            if (err) return;
            var msgs = [];
            for (var i in reply) {
              msgs[i] = JSON.parse(reply[i]);
            }
            sendcmd(session, {cmd:'msgs', msgs:msgs});
            redis.hset(userkey(userid), 'next-read-msg-index', rright+1);
          });
        }
      });
    });
  }
}

// enqueue message to the queue of 'from' and 'to'
function queuemsg(from, to, content, time) {
  function queue(dest) {
    console.log('queue msg for ' + dest);
    redis.hincrby(userkey(dest), 'next-msg-id', 1, function(err, reply) {
      if (err) return;
      var msg = JSON.stringify({id:reply, from:from, to:to, content:content, time:time});
      redis.rpush(mqkey(dest), msg, function(err, reply) {
        if (err) return;
        forwardmsg(dest);
      });
    });
  }
  queue(from);
  queue(to);
}

app.configure(function(){
  app.set('port', process.env.PORT || 3000);
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(express.cookieParser('your secret here'));
  app.use(express.session());
  app.use(app.router);
  app.use(express.static(path.join(__dirname, 'public')));
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

function mqkey(userid) {
  return 'user:' + userid + ':mq';
}

function userkey(userid) {
  return 'user:' + userid;
}

function friendskey(userid) {
  return 'user:' + userid + ':friends';
}

app.get('/', function(req, res) {
  var sessionid = req.session.id;
  if (!isActiveSession(sessionid)) {
    console.error("invalid session:");
    console.error(req.session);
    res.redirect('/login');
    return;
  }
  var user = activeUser(sessionid);
  var params = {};
  params.notification = req.session.notification;
  params.title = 'webim - ' + user.name;
  params.username = user.name;
  params.userid = user.id;
  res.render('index', params);
  req.session.notification = undefined;

  clearHeartbeat(sessionid);
});

app.get('/login', function(req, res) {
  var sessionid = req.session.id;
  if (isActiveSession(sessionid)) {
    res.redirect('/');
  } else {
    var params = {};
    params.title = 'webim';
    params.notification = req.session.notification;
    res.render('login', params);
    req.session.notification = undefined;
  }
});

app.post('/login', function(req, res) {
  console.log(req.body);
  if (!req.body || !req.body.userid || !req.body.password) {
    console.error("invalid login attempt");
    req.session.notification = 'invalid username or password';
    res.redirect('/login');
    return;
  }

  if (!redis) {
    console.error("redis is not initialized.");
    res.statusCode = 500;
    res.end("internal error");
    return;
  }

  var userid = req.body.userid;
  redis.hget(userkey(userid), 'password', function(err, reply) {
    if (err || reply != req.body.password) {
      req.session.notification = 'invalid username or password';
      res.redirect('/login');
      return;
    }
    addActiveSession(userid, req.session.id);
    res.redirect('/');
  });
});

app.get('/friendlist', function(req, res) {
  var sessionid = req.session.id;
  if (!isActiveSession(sessionid)) {
    res.redirect('/login');
    return;
  }

  var user = activeUser(sessionid);
  redis.lrange(friendskey(user.id), 0, -1, function(err, reply) {
    if (err) reply = {};
    var i = 0;
    var fids = reply;
    var friends = {};
    function getfriend() {
      if (i >= fids.length) {
        var msg = JSON.stringify(friends);
        console.log('return friends:');
        console.log(msg);
        res.end(msg);
        return;
      }
      var fid = fids[i++];
      redis.hget(userkey(fid), 'name', function(err, reply) {
        if (err) {
          getfriend();
          return;
        }
        friends[fid] = {id: fid, name: reply};
        getfriend();
      });
    }
    getfriend();
  });

});

app.get('/logout', function(req, res) {
  removeActiveSession(req.session.id);
  res.redirect('/');
});

app.post('/msg', function(req, res) {
  function error(msg) {
    console.log(msg);
    sendres(res, {result:1, msg:msg});
  }

  var sessionid = req.session.id;
  if (!isActiveSession(req.session.id)) {
    error('not login');
    return;
  }
  var user = activeUser(sessionid);
  console.log(req.body);

  if (!req.body.from || !req.body.to || !req.body.content) {
    error('invalid msg');
    return;
  }

  if (!redis) {
    error('redis not valid');
    return;
  }

  var from = req.body.from;
  var to = req.body.to;
  var content = req.body.content;
  var time = req.body.time;

  if (from != user.id) {
    // the msg sender should be the owner of this session
    error('invalid message sender');
    return;
  }

  redis.exists(userkey(from), function(err, reply) {
    if (err || !reply) {
      error('invalid user: ' + from);
      return;
    }
    redis.exists(userkey(to), function(err, reply) {
      if (err || !reply) {
        error("invalid user: " + to);
        return;
      }
      console.log("queue msg");
      queuemsg(from, to, content, time);
      sendres(res, {result: 0});
    });
  });
          
  clearHeartbeat(sessionid);
});

app.post('/background-worker', function(req, res) {
  var sessionid = req.session.id;
  if (!isActiveSession(req.session.id)) {
    res.end(JSON.stringify({cmd:'stop'}));
    return;
  }
  var user = activeUser(sessionid);

  setCommandResponse(sessionid, res);
  clearHeartbeat(sessionid);

  forwardmsg(user.id);
});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
