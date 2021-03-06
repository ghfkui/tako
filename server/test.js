var TestData = require("../testdata.js");
var simplehttp = require('../simplehttp');
var https = require('https');
var fs = require("fs");
var lufaxAcc = {
    user: "coolinker",
    source: "www.lu.com",
    password: TestData.lu.user.coolinker.password,
    tradePassword: TestData.lu.user.coolinker.tradePassword,
    interestLevelMax: 0.2,
    interestLevelMin: 0.08,
    reservedBalance: 0,
    pricePerBidMax: 7000,
    pricePerBidMin: 1500,
    stopConsumeBalance: 5000,
    loginExtendInterval: 5 * 60 * 1000,
    capability: {
        consume: true,
        schedule: true,
        leverage: 3.375

    }

};

var lufaxAcc1 = {
    user: "luhuiqing",
    source: "www.lu.com",
    password: TestData.lu.user.luhuiqing.password,
    tradePassword: TestData.lu.user.luhuiqing.tradePassword,
    interestLevelMax: 0.2,
    interestLevelMin: 0.08,
    reservedBalance: 0,
    pricePerBidMax: 8000,
    pricePerBidMin: 1500,
    stopConsumeBalance: 5000,
    loginExtendInterval: 5 * 60 * 1000,
    capability: {
        consume: true,
        schedule: true,
        leverage: 2.375
    }

};
var lufaxAcc2 = {
    user: "yang_jianhua",
    source: "www.lu.com",
    password: TestData.lu.user.yang_jianhua.password,
    tradePassword: TestData.lu.user.yang_jianhua.tradePassword,
    interestLevelMax: 0.2,
    interestLevelMin: 0.08,
    reservedBalance: 0,
    pricePerBidMax: 7000,
    pricePerBidMin: 1500,
    stopConsumeBalance: 5000,
    loginExtendInterval: 5 * 60 * 1000,
    capability: {
        consume: false,
        schedule: true,
        leverage: 4.375
    }

};


var takoServerIP = "192.168.128.92:4433";//"123.57.39.80";//

function postAccount(acc) {
    simplehttp.POST("https://" + takoServerIP + "/api?action=updateAccount", {
        headers: {
            'Content-type': 'application/json',
        },
        json: {
            body: acc,
        },
        ca: fs.readFileSync('cert/ca-crt.pem'),
        checkServerIdentity: function (host, cert) {
            return undefined;
        }
    },
        function (err, httpResponse, body) {
            try {
                console.log("postAccount:=>", acc.user, err, JSON.stringify(body));
            } catch (e) {
                console.error("postAccount exception:", err, body, e.stack);
            }
        });
}

postAccount(lufaxAcc);
//postAccount(lufaxAcc1);
