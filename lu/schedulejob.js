var mobileheaderutil = require("./mobileheaderutil");
var logutil = require("../logutil").config("lutransfer");
var simplehttp = require('../simplehttp');

var AEPrice = 5800;
var EXdiscount = 0.9;
var EXIntervalDays = 5;
var EXCicleDays = 30;

function randomNumber() {
    return Math.round(Math.random() * 100000);
}

function appendArray(arr0, arr1) {
    arr0.push.apply(arr0, arr1);
}

function isSameDay(d0, d1) {
    return d0.getFullYear() === d1.getFullYear()
        && d0.getMonth() === d1.getMonth()
        && d0.getDate() === d1.getDate()
}


function get000Date(d, offset) {
    if (offset === undefined) offset = 0;
    var date = d ? new Date(d) : new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(0);
    date.setMinutes(0);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
}
/*
 balance ~ 
         AE - EXable - repayment - AE
                         balance ~
                                 AE - EXable - repayment - AE

*/
function updateExpectedEXAmount(account) {
    if (!account.scheduleObj) return;
    var exables = account.scheduleObj.EXables;
    var expectedEXAmount = 0;
    exables.forEach(function (item) {
        expectedEXAmount += getScheduleStatusAmount(item, "*");
    });

    account.scheduleObj.expectedEXAmount = Math.round(expectedEXAmount * 0.9);
    console.log("updateExpectedEXAmount:", account.scheduleObj.expectedEXAmount, ">", account.ongoingTodayBuyBackAmount)
}

exports.schedule = schedule;
function schedule(account, callback) {
    var repayments, recentApply, currentEXable;
    var fun = function () {
        if (repayments && recentApply && currentEXable) {
            var d = {
                orign: 'BALANCE',
                amount: account.availableBalance,
                applyTime: get000Date()

            }
            addScheduleStatus(d, 'available', get000Date(), account.availableBalance);
            var all = currentEXable.concat(recentApply).concat(repayments);
            all.push(d);
            var standardamount = Math.floor(EXdiscount * account.totalAssets * account.capability.leverage / 7);

            var selectedExables = walkThrough(get000Date(), all, standardamount);
            account.scheduleObj = {
                EXables: selectedExables,
                appliedEX: [],
                transferingTotal: 0,
                expectedEXAmount: 0,
                scheduleTime: new Date(),
                lastScheduleCheckTime: null
            }
            updateExpectedEXAmount(account);
            if (callback) callback(account.scheduleObj);
        }
    }

    getRepaymentDetails(account, 2, function (data) {
        repayments = data;
        fun();
    })

    getRecentApply(account, function (data) {
        recentApply = data;
        fun();
    })

    getEXable(account, function (data) {
        currentEXable = data;
        fun();
    })

}

exports.checkSchedule = checkSchedule;
function checkSchedule(account, callback) {
    var exables = account.scheduleObj.EXables;
    if (exables.length === 0) {
        callback();
        return;
    }

    var applied = account.scheduleObj.appliedEX;
    var exable = exables[0];

    var price = exable.remainingPrincipal;
    var price1 = getScheduleStatusAmount(exable, "EXable");
    if (price !== price1) console.log("ERROR***********************************price != price1", price, price1, JSON.stringify(exable));

    updateAppliedEXStatus(account, applied, 1, function (items) {
        var transferingTotal = 0;
        for (var i = 0; i < items.length; i++) {
            if (items[i].M3048Response.isR030Transfering === "true") transferingTotal += items[i].remainingPrincipal;
        }
        account.scheduleObj.transferingTotal = transferingTotal;

        if (account.reservedBalance + 3 * AEPrice > (account.availableBalance + transferingTotal)) {

            getEXInterestRate(account, price, function (rate) {
                if (!rate) {
                    callback();
                    return;
                }
                sellAEforEX(account, exable, rate, function (result) {
                    if (result) {
                        console.log("sellAEforEX", exable.remainingPrincipal, rate, result)
                        applied.push(exables.shift());
                        account.scheduleObj.transferingTotal += EXdiscount * exable.remainingPrincipal;
                        updateExpectedEXAmount(account);
                        account.markInfoUpdate();
                        callback(exable, rate);
                    } else {
                        callback();
                    }

                })
            })

        } else {
            console.log("updateAppliedEXStatus**********:", items.length);
            callback();
        }
    })
    account.scheduleObj.lastScheduleCheckTime = new Date();
}

function walkThrough(date, productList, standardAmount) {
    console.log("workThrough standardAmount*90%", standardAmount * 0.9);
    var day1EXables = [];

    for (var i = 0; i < EXCicleDays + 1; i++) {
        var dt = get000Date(date, i);
        AEToEXable(dt, productList);
        var repayonday = getRepaymentsOnDay(dt, productList, []);
        //var repaytotalday5 = getRepaymentsOnDay(get000Date(dt, EXIntervalDays - 1), productList, []);

        var selectedEXforRepaying = [];
        var buyBack = buyBackOnDay(dt, productList, selectedEXforRepaying);
        if (buyBack === null) {
            if (i > 5) break;
            else return [];
        }

        var maxEXedAmount = getMaxIntervalRepaymentAndEXAmountOfDay(dt, productList);
        //console.log("********", dt.toLocaleString(), preEXedAmount, postEXedAmount);
        var toEXAmount = standardAmount * EXdiscount - maxEXedAmount;
        var paybackbalance = getPaybackBalance(get000Date(dt), get000Date(dt, EXIntervalDays - 1), productList);
        if (paybackbalance < 0) {
            console.log("reserve balance needed:", dt.toLocaleDateString(), paybackbalance)
            toEXAmount = 0;
        } else {
            toEXAmount = Math.min(toEXAmount, paybackbalance);
        }
        var availablebalance = getAvailableBalanceOnDay(dt, productList, []);
        var safevalue = Math.min(toEXAmount, availablebalance + paybackbalance);

        if (safevalue / i < -100) {
            console.log("Can not repay risk!", dt.toLocaleString(), Math.round(standardAmount * EXdiscount), Math.round(maxEXedAmount), toEXAmount);
            if (i > 5) break;
            else return [];
        }
        var reservedbalance = paybackbalance < 0 ? -paybackbalance : 0;


        var selectedExables0 = [];
        var selectedBalance = selectEXablesToEX(dt, toEXAmount, productList, selectedExables0);
        toEXAmount = Math.min(selectedBalance, toEXAmount);

        var selectedEXables = [];
        selectedBalance = selectEXablesToEX(dt, toEXAmount, productList, selectedEXables);
        if (selectedBalance > toEXAmount) selectedEXables.pop();

        if (i === 0) {
            appendArray(day1EXables, selectedEXforRepaying);
            appendArray(day1EXables, selectedEXables)
        }

        var balanceFromEX = EXForBalance(dt, selectedEXables);
        console.log(dt.toLocaleString(), "BuyBack", repayonday, "+ EX*90%:", Math.round(balanceFromEX.amount), "Interval max:", Math.round(maxEXedAmount), Math.round(maxEXedAmount + balanceFromEX.amount))
        productList.push(balanceFromEX);

        var remainbalance = balanceToAE(dt, reservedbalance, productList);
        if (remainbalance < 0) {
            console.log("remain balance <0 risk", dt, remainbalance, reservedbalance);
        }
    }

    day1EXables.sort(function (e0, e1) {
        var amt0 = getScheduleStatusAmount(e0, "*");
        var amt1 = getScheduleStatusAmount(e1, "*");
        if (amt0 > amt1) return 1;
        if (amt0 < amt1) return -1;
        if (amt0 === amt1) return 0;
    });


    return day1EXables;
}

function getPaybackBalance(start, end, productList) {
    var dt = start;
    var interval = 5 * 24 * 3600 * 1000;
    var minbalance = Math.pow(2, 53) - 1;
    var balance = 0;
    for (var i = 0; dt <= end; i++) {
        dt = get000Date(start, i);
        var repay = getRepaymentsTotalOfDay(dt, productList, []);
        var exsum = 0;
        for (var j = 0; j < productList.length; j++) {
            var d = productList[j];
            if (getScheduleStatus(d) === "AE") {
                var applyTime = getScheduleStatusTime(d, "AE");
                if (dt - applyTime === interval) {
                    var amt = EXdiscount * getScheduleStatusAmount(d, "AE");
                    exsum += amt;
                }
            }

            if (i === 0 && getScheduleStatus(d) === "EXable") {
                var amt = EXdiscount * getScheduleStatusAmount(d, "EXable");
                exsum += amt;
            }


            // addScheduleStatus(d, "EXable", get000Date(date), getScheduleStatusAmount(d, "AE"));
        }
        balance += exsum - repay;
        minbalance = Math.min(minbalance, balance);
        // if (minbalance < 0) {
        //     console.log("===", dt, exsum, repay, balance, minbalance)
        // }

    }

    return minbalance;
}


function getTotalRepaymentAndEXAmount(from, to, productList) {
    var amount = 0;
    for (var i = 0; i < productList.length; i++) {
        var prd = productList[i];
        if (getScheduleStatus(prd) === "repayment") {
            var dt = getScheduleStatusTime(prd, "repayment");
            var exdt = get000Date(dt, -EXCicleDays);
            if (dt >= from && dt <= to || exdt >= from && exdt <= to) {
                var amt = getScheduleStatusAmount(prd, "repayment");
                amount += amt;
            }
        }
    }

    return amount;
}

function getMaxIntervalRepaymentAndEXAmountOfDay(date, productList) {
    var max = 0;
    for (var i = EXIntervalDays - 1; i >= 0; i--) {
        var start = get000Date(date, -i);
        var end = get000Date(start, EXIntervalDays - 1);
        var val = getTotalRepaymentAndEXAmount(start, end, productList);
        //if (date.getDate() === 16 || date.getDate() === 14) console.log(start.toLocaleDateString(), end.toLocaleDateString(), val)
        max = Math.max(max, val);
    }

    return max;
}


function buyBackOnDay(date, productList, selectedEXables) {
    selectedEXables.length = 0;
    var dayrepayments = [];
    var repaytotal = getRepaymentsOnDay(date, productList, dayrepayments);

    if (repaytotal > 0) {

        var remainAmount = repayByBalanceOnDay(date, repaytotal, productList);
        //console.log(date.toLocaleString(), "pay by balance:", repaytotal - remainAmount, remainAmount);

        if (remainAmount > 0) {
            var selectedBalance = selectEXablesToEX(date, remainAmount, productList, selectedEXables);

            if (selectedBalance < remainAmount) {
                console.log("********************* can not repay", date, selectedBalance, remainAmount);
                return null;
            }

            var balanceFromEX = EXForBalance(date, selectedEXables);

            productList.push(balanceFromEX);
            var remain = repayByBalanceOnDay(date, remainAmount, productList);
            console.log("****Buyback:", repaytotal, "- balance = ", remainAmount, "= EX", selectedBalance)

        }

        dayrepayments.forEach(function (repayment) {
            var amount;
            if (repayment.orign === "R030_TRANSFERABLE") {
                amount = getScheduleStatusAmount(repayment, "repayment");
            } else if (repayment.orign === "REPAYMENT") {
                amount = repayment.expectedRepaymentAmount;
            } else console.log("ERROR****************", repayment.orign)
            addScheduleStatus(repayment, "AE", get000Date(date), amount / EXdiscount);
        });
    }

    return Math.round(repaytotal);
}

function EXForBalance(date, exables) {
    var balance = 0;
    exables.forEach(function (exable) {
        var amount = getScheduleStatusAmount(exable, "EXable");
        addScheduleStatus(exable, "repayment", get000Date(date, EXCicleDays), amount * EXdiscount);
        balance += amount * EXdiscount;
    })

    var d = {
        orign: 'BALANCE',
        amount: balance,
        applyTime: get000Date(date)

    }
    addScheduleStatus(d, 'available', get000Date(date), balance);

    return d;
}


function repayByBalanceOnDay(date, amount, productList) {
    var balances = [];
    var available = getAvailableBalanceOnDay(date, productList, balances);
    for (var i = 0; i < balances.length; i++) {
        var blc = getScheduleStatusAmount(balances[i], "available");
        amount -= blc;
        addScheduleStatus(balances[i], "available", get000Date(date), 0);
    }

    if (amount < 0) {
        var d = {
            orign: 'BALANCE',
            amount: -amount,
            applyTime: get000Date(date)

        }
        addScheduleStatus(d, 'available', get000Date(date), -amount);
        productList.push(d);
    }

    return Math.round(amount);
}

function getAvailableBalanceOnDay(date, productList, out_Balances) {
    var availables = [];
    var totalamount = 0;
    for (var i = 0; i < productList.length; i++) {
        var availableDate = getScheduleStatusTime(productList[i], "available");
        if (!availableDate || availableDate > date) continue;
        var available = getScheduleStatusAmount(productList[i], "available");
        if (available > 0) {
            totalamount += available;
            out_Balances.push(productList[i]);
        }
    }

    out_Balances.sort(function (b0, b1) {
        b0 = getScheduleStatusAmount(b0, "available");
        b1 = getScheduleStatusAmount(b1, "available");
        if (b0 > b1) return -1;
        if (b0 < b1) return 1;
        if (b0 === b1) return 0;

    });

    return totalamount;
}

function selectEXablesToEX(date, totalamount, productList, selectedEXables) {

    selectedEXables.length = 0;
    var validEXables = [];
    for (var i = 0; i < productList.length; i++) {
        if (getScheduleStatus(productList[i]) === "EXable" && getScheduleStatusTime(productList[i]) <= date) {
            validEXables.push(productList[i]);
        }
    }

    validEXables.sort(function (e0, e1) {
        var amt0 = getScheduleStatusAmount(e0, "EXable");
        var amt1 = getScheduleStatusAmount(e1, "EXable");
        if (amt0 > amt1) return -1;
        if (amt0 < amt1) return 1;
        if (amt0 === amt1) return 0;
    });

    var minvalue = Number.MAX_SAFE_INTEGER;
    var minselected;
    var remain = totalamount;
    for (var j = 0; j < validEXables.length; j++) {
        var amt = EXdiscount * getScheduleStatusAmount(validEXables[j], "EXable");

        if (amt <= remain) {
            remain -= amt;
            selectedEXables.push(validEXables[j]);
            if (remain === 0) break;
        } else if (amt - remain < minvalue) {
            minselected = selectedEXables.concat([validEXables[j]]);
            minvalue = amt - remain;
        }

    }

    if (remain !== 0 && minselected) {
        selectedEXables.length = 0;
        appendArray(selectedEXables, minselected);
        remain = -minvalue;
    }

    return totalamount - remain;
}

function getRepaymentsTotalOfDay(date, data, repayments) {
    repayments.length = 0;
    var total = 0;
    for (var i = 0; i < data.length; i++) {
        var d = data[i];
        if (getScheduleStatus(d) !== "repayment") continue;
        var expectedDate = getScheduleStatusTime(d, "repayment")
        if (expectedDate.getTime() === date.getTime()) {
            repayments.push(d);
            total += getScheduleStatusAmount(d, "repayment");
        }
    }

    return Math.round(total);
}

function getRepaymentsOnDay(date, data, repayments) {
    repayments.length = 0;
    var total = 0;
    for (var i = 0; i < data.length; i++) {
        var d = data[i];
        if (getScheduleStatus(d) !== "repayment") continue;
        var expectedDate = getScheduleStatusTime(d, "repayment")
        if (expectedDate <= date) {
            repayments.push(d);
            total += getScheduleStatusAmount(d, "repayment");
        }
    }
    repayments.sort(function (rep0, rep1) {
        var rep0v = getScheduleStatusAmount(rep0, "repayment");
        var rep1v = getScheduleStatusAmount(rep1, "repayment");
        if (rep0v > rep1v) return 1;
        if (rep0v < rep1v) return -1;
        return 0;
    })

    return Math.round(total);
}

function balanceToAE(date, reserved, productList) {

    var balances = [];
    var available = getAvailableBalanceOnDay(date, productList, balances);
    available -= reserved;
    var c = Math.floor(available / AEPrice);

    for (var i = 0; i < c; i++) {
        var d = {
            orign: 'BALANCE_AE',
            investmentAmount: AEPrice,
            applyTime: get000Date(date)

        }
        available -= AEPrice;
        addScheduleStatus(d, 'AE', get000Date(date), AEPrice);
        productList.push(d);
    }

    balances.forEach(function (balance) {
        addScheduleStatus(balance, "available", get000Date(date), 0);
    })



    if (available > 0) {
        var d = {
            orign: 'BALANCE',
            amount: available + reserved,
            applyTime: get000Date(date)

        }
        addScheduleStatus(d, 'available', get000Date(date), d.amount);
        productList.push(d);
    }



    return available;
}

function AEToEXable(date, data) {
    var latest = get000Date(date, -EXIntervalDays);
    for (var i = 0; i < data.length; i++) {
        var d = data[i];

        if (getScheduleStatus(d) !== "AE") continue;
        var applyTime = getScheduleStatusTime(d, "AE");
        if (applyTime > latest) continue;

        addScheduleStatus(d, "EXable", get000Date(date), getScheduleStatusAmount(d, "AE"));
    }

    return data;
}


function getScheduleStatusAmount(d, status) {
    if (!d.scheduleStatus || d.scheduleStatus.length === 0 || status !== '*' && getScheduleStatus(d) !== status) return null;
    return d.scheduleStatus[d.scheduleStatus.length - 1].amount;
}

function getScheduleStatusTime(d, status) {
    if (!d.scheduleStatus || d.scheduleStatus.length === 0 || getScheduleStatus(d) !== status) return null;
    return d.scheduleStatus[d.scheduleStatus.length - 1].time;
}

function getScheduleStatus(d) {
    if (!d.scheduleStatus || d.scheduleStatus.length === 0) return null;
    return d.scheduleStatus[d.scheduleStatus.length - 1].status;
}

function addScheduleStatus(data, status, time, amount) {
    time = new Date(time);
    if (data.scheduleStatus === undefined) data.scheduleStatus = [];
    data.scheduleStatus.push({ status: status, time: time, amount: amount });
}

function getRepaymentDetails(account, months, callback, seq) {
    if (seq === undefined) seq = 0;
    console.log("getRepaymentDetails", seq, months)
    var date = new Date();
    date.setMonth(date.getMonth() + seq);
    var dateStr = date.toJSON().substr(0, 10);
    simplehttp.POST("https://ma.lu.com/mapp/service/private?M6130&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M6130",
            version: "3.4.9",
            params: '{"startDate":"' + dateStr + '"}'
        }
    },
        function (err, httpResponse, body) {
            try {
                var result = JSON.parse(body).result.repaymentCalendarDetails;
                var repayments = [];
                result.forEach(function (d) {
                    d.loanPlanItems.forEach(function (item) {
                        if (item.planStatus === 'SETTLED') return;
                        item.orign = 'REPAYMENT';
                        item.expectedRepaymentDate = get000Date(item.expectedRepaymentDate);
                        item.expectedRepaymentAmount = item.expectedRepaymentAmount;
                        addScheduleStatus(item, "repayment", get000Date(item.expectedRepaymentDate), item.expectedRepaymentAmount);
                        repayments.push(item);
                    });
                });

                if (seq < months - 1) {
                    getRepaymentDetails(account, months, function (details) {
                        callback(repayments.concat(details));
                    }, seq + 1)
                } else {
                    callback(repayments);
                }

            } catch (e) {
                console.error("getRepaymentDetails exception:", err, e.stack);
                callback(null);
            }
        });
}

function getRecentApply(account, callback) {
    requestM6059(account, 'APPLY', '', function (data) {
        var applys = [];
        var today = get000Date();
        for (var i = 0; i < data.length; i++) {
            var time = get000Date(data[i].applyTime, EXIntervalDays);
            if (time > today) {
                addScheduleStatus(data[i], "AE", get000Date(data[i].applyTime), Number(data[i].investmentAmount.replace(',', '')))
                applys.push(data[i])
            }

        }
        console.log("Valid applys:", applys.length)
        callback(applys);
    })
}

function getEXable(account, callback) {
    //{"sortType":"desc","requestType":"ONGOING","assetType":"FINANCE","filter":"R030_TRANSFERABLE","pageNum":2}
    requestM6059(account, 'ONGOING', 'R030_TRANSFERABLE', function (data) {
        data.forEach(function (item) {
            addScheduleStatus(item, "EXable", get000Date(), item.remainingPrincipal);
        })
        callback(data);
    })
}


function requestM6059(account, requestType, filter, callback, pageNum) {
    if (!pageNum) pageNum = 1;
    //console.log("requestM6059", requestType, filter, pageNum)
    simplehttp.POST("https://ma.lu.com/mapp/service/private?M6059&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M6059",
            version: "3.4.9",
            //{"sortType":"desc","requestType":"APPLY","assetType":"FINANCE","filter":"","pageNum":"1"}
            params: '{"sortType":"desc","requestType":"' + requestType + '","assetType":"FINANCE","filter":"' + filter + '","pageNum":"' + pageNum + '"}'
        }
    },
        function (err, httpResponse, body) {
            try {
                var result = JSON.parse(body).result.data.paginationGson;
                result.data.forEach(function (d) {
                    d.orign = filter ? filter : requestType;
                });


                if (pageNum < Number(result.totalPage)) {
                    requestM6059(account, requestType, filter, function (applys) {
                        callback(applys.concat(result.data));
                    }, pageNum + 1)
                } else {
                    callback(result.data);
                }

            } catch (e) {
                console.error("getRecentApply exception:", err, e.stack);
                callback(null);
            }
        });
}

function getEXInterestRate(account, minPrice, callback) {
    simplehttp.POST("https://ma.lu.com/mapp/service/public?M3024&listType=r030&_" + randomNumber(), {
        headers: {
            "mobile_agent": "appVersion:3.4.9,platform:android,osVersion:17,device:GT-P5210,resourceVersion:2.7.0,channel:H5",
            "X-LUFAX-MOBILE-DATA-AGENT": '',
            "x-lufax-mobile-t": '',
            "x-lufax-mobile-signature": ''
        },
        form: {
            requestCode: "M3024",
            version: "3.4.9",
            //{"cookieUserName":"MjAyMDk2RjZGN0IyNDc2OUZCNzRGQTNDMDQ2RTlBNTk=","readListType":"r030","filterEndMinInvestAmount":"0.6","source":"android","width":720,"listType":"r030","pageSize":"15","ver":"1","isForNewUser":"false","currentPage":"1","forNewUser":"false","pageIndex":"1"}
            params: '{"cookieUserName":"","readListType":"r030","filterEndMinInvestAmount":"' + minPrice / 10000 + '","source":"android","width":720,"listType":"r030","pageSize":"15","ver":"1","isForNewUser":"false","currentPage":"1","forNewUser":"false","pageIndex":"1"}'
        }
    },
        function (err, httpResponse, body) {
            try {

                var json = JSON.parse(body).result.products[0].productList;
                if (json.length <= 5) {
                    callback(4.51)
                    return;
                }

                var r0 = Number(json[0].interestRate);
                var r0prc = json[0].remainingAmount;
                var r5 = Number(json[5].interestRate);
                var r5prc = json[5].remainingAmount;
                var now = new Date();
                var hours = now.getHours() + now.getMinutes() / 60;
                //var r10 = json[10].interestRate;
                var r = r0;
                if (r0 === r5 || r5prc - r0prc > 200) {
                    r = r0 + 0.0001;
                } else if (r0 - r5 >= 0.0005) {
                    r = r5 + 0.0001;
                }

                callback(Math.floor(r * 10000) / 100);
            } catch (e) {
                callback(null);
                console.log("******************", e.stack)
            }
        });

}

function updateAppliedEXStatus(account, exables, idx, callback) {
    if (exables.length === 0) {
        callback([]);
        return;
    }
    var exable = exables[idx];
    while (exable && exable.M3048Response.isR030Transfering === "false" && exable.M3048Response.isR030Transferable === "false") {
        exable = exables[++idx];

    }
    if (!exable) {
        callback(exables);
        return;
    }

    var investmentId = exable.investmentId;
    requestM3048(account, investmentId, function (result) {
        if (result) {
            exable.M3048Response = result;
        }

        if (idx + 1 < exables.length) updateAppliedEXStatus(account, exables, idx + 1, callback);
        else callback(exables)
    })
}


function sellAEforEX(account, exable, rate, callback) {
    var investmentId = exable.investmentId;
    requestM3048(account, investmentId, function (result) {
        if (!result) {
            callback(null);
            return;
        }
        exable.M3048Response = result;
        requestM3105(account, investmentId, function () {
            requestM3105rate(account, investmentId, rate, callback)
        });

    })
}

function requestM3048(account, investmentId, callback) {
    simplehttp.POST("https://ma.lu.com/mapp/service/private?M3048&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M3048",
            version: "3.4.9",
            params: '{"investmentId":"' + investmentId + '","isAne":true}'
        }
    },
        function (err, httpResponse, body) {
            if (err) {
                callback(null);
                return;
            }
            var json = JSON.parse(body);
            callback(json.result);
            // requestM3105(account, investmentId, callback);
        });

}

function requestM3105(account, investmentId, callback) {
    simplehttp.POST("https://ma.lu.com/mapp/service/private?M3105&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M3105",
            version: "3.4.9",
            params: '{"investmentId":"' + investmentId + '"}'
        }
    },
        function (err, httpResponse, body) {
            if (err) {
                callback(null);
                return;
            }
            var json = JSON.parse(body);
            callback(json.result);
        });

}

function requestM3105rate(account, investmentId, rate, callback) {
    simplehttp.POST("https://ma.lu.com/mapp/service/private?M3105&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M3105",
            version: "3.4.9",
            params: '{"investmentId":' + investmentId + ',"transferRate":' + rate + '}'
        }
    },
        function (err, httpResponse, body) {
            if (err) {
                callback(null);
                return;
            }

            var json = JSON.parse(body);
            if (!json.result) {
                console.log("Error requestM3105rate", investmentId, rate, body);
                callback(null);
            } else {
                json.result.interestRate = rate;
                requestM3107(account, json.result, callback);
            }
        });

}


function requestM3107(account, M3105Result, callback) {
    var cncryptPassword = account.rsakey.encrypt(account.tradePassword);

    simplehttp.POST("https://ma.lu.com/mapp/service/private?M3107&_" + randomNumber(), {
        "cookieJar": account.cookieJar,
        "headers": mobileheaderutil.getHeaders(account.uid),
        form: {
            requestCode: "M3107",
            version: "3.4.9",
            //{"serviceFee":7.5,"transferPrice":8339.13,"repurchasePrice":"8372.83","transferInterestRate":4.85,"paramId":101,"sourceDevice":"ANDROID","investmentId":22908667,"password":""}
            params: '{"serviceFee":' + M3105Result.repurchasePriceGsons[0].serviceFee
            + ',"transferPrice":' + M3105Result.repurchasePriceGsons[0].transferPrice
            + ',"repurchasePrice":"' + M3105Result.buyBackAmount + '","transferInterestRate":'
            + M3105Result.interestRate + ',"investmentId":' +
            M3105Result.investmentId + ',"password":"' + cncryptPassword + '","paramId":' + M3105Result.repurchasePriceGsons[0].paramId + ',"sourceDevice":"ANDROID"}'
        }
    },
        function (err, httpResponse, body) {
            if (err) {
                callback(null);
                return;
            }
            var json = JSON.parse(body);
            callback(json.result);
        });

}

