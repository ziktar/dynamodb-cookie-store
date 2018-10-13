AWS DynamoDB Cookie Store API

Another NoSQL DynamoDB store for tough-cookie module.

## Installation
``` sh
$ npm install dynamodb-cookie-store
```

## Usage
``` js
var DynamoDBCookieStore = require('dynamodb-cookie-store');
var CookieJar = require('tough-cookie').CookieJar;
var AWS = require('aws-sdk');
AWS.config.update({
  region: 'us-west-2',
  endpoint: 'http://localhost:8000',
  // accessKeyId default can be used while using the downloadable version of DynamoDB. 
  // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito instead.
  accessKeyId: 'MyKeyId',
  // secretAccessKey default can be used while using the downloadable version of DynamoDB. 
  // For security reasons, do not store AWS Credentials in your files. Use Amazon Cognito instead.
  secretAccessKey: 'SecretAccessKey'
});

// Please create Table `cookie` first to use this package!
// Example createTable by JS code or you can do this by Create Table GUI on DynamoDB Web Console
var DynamoDB = new AWS.DynamoDB();
DynamoDB.createTable({
  TableName: "cookie",
  KeySchema: [
    { AttributeName: "email", KeyType: "HASH" }
  ],
  AttributeDefinitions: [
    { AttributeName: "email", AttributeType: "S" }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
}, function (err, data) {
  if (err) {
    console.log("Unable to create table: " + "\n" + JSON.stringify(err, undefined, 2));
  }
  else {
    console.log("Created table: " + "\n" + JSON.stringify(data, undefined, 2));
  }
})

// Define one instance Store based on email property
var docClient = new AWS.DynamoDB.DocumentClient(); // client for DynamoDB
 // DynamoDBCookieStore use the key `email` to manage cookie
var store = new DynamoDBCookieStore('example@gmail.com', docClient);
var jar = new CookieJar(store);

/* request example */
var request = require('request');
request = request.defaults({ jar : jar });
request('http://www.google.com', function() {
  request('http://images.google.com')
})
```

## License
MIT

