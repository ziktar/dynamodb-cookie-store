'use strict';
var tough = require('tough-cookie');
var Store = tough.Store;
var permuteDomain = tough.permuteDomain;
var permutePath = tough.permutePath;
var util = require('util');
var AWS = require('aws-sdk');

function DynamoDBCookieStore(email, DynamoDBClient, cb, tableName = 'cookie') {
  if (!(DynamoDBClient instanceof AWS.DynamoDB.DocumentClient))
    throw new Error('Invalid DynamoDB DocumentClient')
  if (!tableName || tableName.length < 3 || tableName.length > 255 || !/^[A-Za-z0-9_.\-]+$/.test(tableName)) {
    throw new Error('Invalid tableName; must be 3-255 chars of A-Z, a-z, 0-9, _, -, or . only')
  }
  Store.call(this);
  this.email = email;
  this.idx = {}; // idx is memory cache
  this.DynamoDBClient = DynamoDBClient;
  this.tableName = tableName;
  const self = this;
  this._get(function (err, data) {
    if (!err && data.Item) self.idx = data.Item.cookie || {};
    cb && cb(err, self);
  });
}

util.inherits(DynamoDBCookieStore, Store);
module.exports = DynamoDBCookieStore;

DynamoDBCookieStore.prototype.synchronous = true;

// force a default depth:
DynamoDBCookieStore.prototype.inspect = function () {
  return "{ idx: " + util.inspect(this.idx, false, 2) + ' }';
};

// Use the new custom inspection symbol to add the custom inspect function if
// available.
if (util.inspect.custom) {
  DynamoDBCookieStore.prototype[util.inspect.custom] = DynamoDBCookieStore.prototype.inspect;
}

DynamoDBCookieStore.prototype._get = function (cb) {
  const self = this;
  self.DynamoDBClient.get({
    TableName: this.tableName,
    Key: {
      email: self.email
    }
  }, function (err, data) {
    if (err && err.statusCode == 400)
      throw new Error('Please create table "' + this.tableName + '" in DynamoDB to use this package!')
    if (!data || !data.Item)
      return cb(err, data)
    for (var domainName in data.Item.cookie) {
      for (var pathName in data.Item.cookie[domainName]) {
        for (var cookieName in data.Item.cookie[domainName][pathName]) {
          data.Item.cookie[domainName][pathName][cookieName] = tough.fromJSON(data.Item.cookie[domainName][pathName][cookieName]);
        }
      }
    }
    return cb(err, data)
  });
}

DynamoDBCookieStore.prototype.findMaxTtl = function (cookie) {
  var maxTtl = null;
  for (var domain in cookie) {
    for (var path in cookie[domain]) {
      for (var key in cookie[domain][path]) {
        var expiration = cookie[domain][path][key].expiryTime();
        if (expiration == Infinity) {
          // a cookie that never expires, so store null in the ttl field
          return null;
        }

        if (expiration > maxTtl) {
          maxTtl = expiration;
        }
      }
    }
  }
  return maxTtl;
}

DynamoDBCookieStore.prototype._put = function (cookie, cb) {
  const self = this;
  var maxTtl = this.findMaxTtl(cookie);
  
  var cookieJSON = JSON.parse(JSON.stringify(cookie));
  self.DynamoDBClient.put({
    TableName: this.tableName,
    Item: {
      email: self.email,
      cookie: cookieJSON,
      ttl: maxTtl ? Math.floor(maxTtl / 1000) : null // Amazon wants epoch-seconds, not milliseconds
    }
  }, cb);
}

DynamoDBCookieStore.prototype.findCookie = function (domain, path, key, cb) {
  const self = this;
  if (!self.idx[domain] || !self.idx[domain][path])
    return cb(null, undefined);
  return cb(null, self.idx[domain][path][key] || null);
};

DynamoDBCookieStore.prototype.findCookies = function (domain, path, cb) {
  const self = this;
  var results = [];
  if (!domain) {
    return cb(null, []);
  }
  var domains = permuteDomain(domain) || [domain];
  domains.forEach(function (curDomain) {
    var domainIndex = self.idx[curDomain];
    if (!domainIndex) {
      return;
    }
    // null or '/' means "all paths"
    if (!path) {
      for (var curPath in domainIndex) {
        var pathIndex = domainIndex[curPath];
        for (var key in pathIndex) {
          results.push(pathIndex[key]);
        }
      }
    }
    else if (path === '/') {
      var pathIndex = domainIndex['/'];
      if (!pathIndex) {
        return;
      }
      for (var key in pathIndex) {
        results.push(pathIndex[key]);
      }
    }
    else {
      var paths = permutePath(path) || [path];
      paths.forEach(function (curPath) {
        var pathIndex = domainIndex[curPath];
        if (!pathIndex) {
          return;
        }
        for (var key in pathIndex) {
          results.push(pathIndex[key]);
        }
      });
    }
  });
  return cb(null, results);
};

DynamoDBCookieStore.prototype.putCookie = function (cookie, cb) {
  const self = this;
  if (!self.idx[cookie.domain]) {
    self.idx[cookie.domain] = {};
  }
  if (!self.idx[cookie.domain][cookie.path]) {
    self.idx[cookie.domain][cookie.path] = {};
  }
  self.idx[cookie.domain][cookie.path][cookie.key] = cookie;
  self._put(self.idx, cb);
};

DynamoDBCookieStore.prototype.updateCookie = function updateCookie(oldCookie, newCookie, cb) {
  // updateCookie() may avoid updating cookies that are identical.  For example,
  // lastAccessed may not be important to some stores and an equality
  // comparison could exclude that field.
  this.putCookie(newCookie, cb);
};

DynamoDBCookieStore.prototype.removeCookie = function (domain, path, key, cb) {
  const self = this;
  if (self.idx[domain] && self.idx[domain][path] && self.idx[domain][path][key]) {
    delete self.idx[domain][path][key];
  }
  self._put(self.idx, cb);
};

DynamoDBCookieStore.prototype.removeCookies = function (domain, path, cb) {
  const self = this;
  if (!self.idx[domain]) {
    return cb(null);
  }
  else if (path) {
    delete self.idx[domain][path];
  }
  else {
    delete self.idx[domain];
  }
  return cb(null);
};

DynamoDBCookieStore.prototype.getAllCookies = function (cb) {
  const self = this;
  var cookies = [];
  var idx = self.idx;
  for (var domain in idx) {
    for (var path in idx[domain]) {
      for (var key in idx[domain][path]) {
        cookies.push(idx[domain][path][key]);
      }
    }
  }

  // Sort by creationIndex so deserializing retains the creation order.
  // When implementing your own store, this SHOULD retain the order too
  cookies.sort(function (a, b) {
    return (a.creationIndex || 0) - (b.creationIndex || 0);
  });

  cb(null, cookies);
};
