/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');

const defaultData = require('../data/default.js');

const config = require('../services/config.js');
const guilds = require('../configs/discords.json').discords;

const StripeClient = require('../services/stripe.js');
const DiscordClient = require('../services/discord.js');

// const catchAsyncErrors = fn => ((req, res, next) => {
//     const routePromise = fn(req, res, next);
//     if (routePromise.catch) {
//         routePromise.catch(err => next(err));
//     }
// });
router.get('/sessionlimit', async (req, res) => {
    const data =  Object.assign({}, defaultData, req.session);
    req.session.destroy();
    res.render('sessionlimit', data);
});

router.get('/subscribe', async (req, res) => {
    let guild = false;
    if (guilds.length > 1) {
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            if (`https://${req.get('host')}`.includes(guilds[d].domain)) {
                guild = guilds[d]; break;
            }
        }
    } else { 
        guild = guilds[0];
    }
    if (guild) {
        if (!req.session.email || !req.session.user_id || !req.session.guild_id) {
            req.session.destroy();
            return res.redirect('/login');
        }
        req.session.guild_name = guild.name;
        req.session.key = guild.test_pk ? guild.test_pk : config.stripe.live_pk;
        req.session.map_url = `https://${req.get('host')}`;
        req.session.recurring_id = guild.recurring_id;
        req.session.onetime_id = guild.onetime_id;
        req.session.amt1 = guild.recurring_cost;
        req.session.amt2 = guild.onetime_cost;
        req.session.donor_role = guild.donorRole;
        const customer = new StripeClient(req.session);
        const record = await customer.fetchRecordByUser();
        if (record) {
            customer.setClientInfo(record);
            if (customer.customerId && customer.subscriptionId) {
                res.redirect('/account');
                return;
            } else {
                const data =  Object.assign({}, defaultData, req.session);
                res.render('subscribe', data);
                return;
            }
        } else {
            customer.insertDbRecord();
            res.redirect('/login');
            return;
        }
    } else {
        console.log(`[MapJS] [${getTime()}] [routes/stripe.js] No matching guild for https://${req.get('host')}`);
        res.redirect('/guildError');
        return;
    }
});


router.get('/account', async (req, res) => {
    let guild = false;
    if (guilds.length > 1) {
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            if (`https://${req.get('host')}`.includes(guilds[d].domain)) {
                guild = guilds[d]; break;
            }
        }
    } else { 
        guild = guilds[0];
    }
    if (guild) {
        if (!req.session.user_id) {
            return res.redirect('/login');
        }
        const customer = new StripeClient(req.session);
        const record = await customer.fetchRecordByUser();
        req.session.subscriptions = [];
        try {
            req.session.guild_name = guild.name;
            req.session.key = guild.test_pk ? guild.test_pk : config.stripe.live_pk;
            req.session.map_url = `https://${req.get('host')}`;
            req.session.recurring_id = guild.recurring_id;
            req.session.onetime_id = guild.onetime_id;
            req.session.amt1 = guild.recurring_cost;
            req.session.amt2 = guild.onetime_cost;
            req.session.donor_role = guild.donorRole;
            if (record) {
                const records = await customer.fetchAccountRecords();
                for (let r = 0, rlen = records.length; r < rlen; r++) {
                    let user_record = {};
                    user_record.subscription = records[r].guild_name;
                    if (records[r].customer_id == 'Lifetime') {
                        user_record.lifetime = true;
                        user_record.created = false;
                        user_record.next_payment = false;
                        user_record.renewable = false;
                        user_record.end_date = false;
                        user_record.cancellable = false;
                        user_record.update_payment = false;
                        req.session.subscriptions.push(user_record);
                    } else {
                        customer.setClientInfo(records[r]);
                        user_record.customer_id = records[r].customer_id;
                        const valid = await customer.validateCustomer();
                        if (valid) {
                            if (Number.isInteger(parseInt(records[r].subscription_id))) {
                                user_record.created = moment.unix(customer.customerObject.created).format('D-MMM-YYYY');
                                user_record.next_payment = false;
                                user_record.renewable = true;
                                user_record.end_date = moment.unix(parseInt(records[r].subscription_id)).format('ddd, MMM Do');
                                user_record.cancellable = false;
                                user_record.update_payment = false;
                                req.session.subscriptions.push(user_record);
                            } else {
                                let sub_valid = await customer.validateSubscription();
                                if (sub_valid) {
                                    user_record.created = moment.unix(customer.customerObject.created).format('D-MMM-YYYY');
                                    user_record.renewable = false;
                                    if (customer.customerObject.subscriptions.data[0].cancel_at_period_end) {
                                        user_record.end_date = moment.unix(customer.customerObject.subscriptions.data[0].current_period_end).format('ddd, MMM Do');
                                        user_record.next_payment = 'Cancelled';
                                        user_record.reactivatable = true;
                                    } else {
                                        user_record.end_date = false;
                                        user_record.next_payment = moment.unix(customer.customerObject.subscriptions.data[0].current_period_end).format('ddd, MMM Do');
                                        user_record.reactivatable = false;
                                        user_record.update_payment = true;
                                        user_record.cancellable = true;
                                    }
                                    let session = await customer.createSession();
                                    user_record.session_id = session.id;
                                    req.session.subscriptions.push(user_record);
                                } else {
                                    if (customer.customerObject.subscriptions.data[0]) {
                                        if (customer.customerObject.subscriptions.data[0].status == 'past_due') {
                                            user_record.created = moment.unix(customer.customerObject.created).format('D-MMM-YYYY');
                                            user_record.next_payment = moment.unix(customer.customerObject.subscriptions.data[0].current_period_end).format('dddd, MMMM Do');
                                            user_record.renewable = false;
                                            user_record.end_date = 'PAST DUE';
                                            user_record.cancellable = false;
                                            user_record.update_payment = true;
                                            let session = await customer.createSession();
                                            user_record.session_id = session.id;
                                            req.session.subscriptions.push(user_record);
                                        }
                                    }
                                }
                            }
                        }
                    }                                                                   
                }
                req.session.subscriptions = JSON.stringify(req.session.subscriptions);
                const data =  Object.assign({}, defaultData, req.session);
                res.render('account', data);
                return;
            }
        } catch(e) {
            console.log(`[MapJS] [${getTime()}] [routes/stripe.js] Error preparing customer data for account page.`, '\ncustomer', customer, '\nerror', e);
        }
    } else {
        console.log(`[MapJS] [${getTime()}] [routes/stripe.js] No matching guild for https://${req.get('host')}`);
        res.redirect('/error');
    }
});

router.get('/error', (req, res) => {
    res.render('error', defaultData);
});

router.get('/success', async function(req, res) {
    req.session.updated = 0;
    req.session.save();
    const customer = new StripeClient(req.session);
    const guild = await customer.identifyGuild();
    const session = await customer.retrieveSession(req.query.session_id);
    if (session) {
        customer.customerId = session.customer;
        req.session.customer_id = session.customer;
        customer.updateCustomerName(session.customer, session.client_reference_id);
        const record = await customer.fetchRecordByUser();
        const user = new DiscordClient(record);
        user.donorRole = guild.donorRole;
        if (!session.subscription || session.subscription === null) {
            customer.planId = req.session.onetime_id;
            if (Number.isInteger(parseInt(record.subscription_id))) {
                //customer.insertStripeLog('Received Renewal Payment for One Month Access.');
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'One Month Access Renewal! 📋', '');
                customer.subscriptionId = moment.unix(record.subscription_id).add(1, 'M').unix();
                customer.updateCustomerMetadata({
                    onetime: true,
                    expiration: customer.subscriptionId,
                    plan_id: customer.planId
                });
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'One Month Access Extended! 📋', '');
            } else {
                //customer.insertStripeLog('Received Payment for One Month Access.');
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'New One Month Access Payment! 📋', '');
                customer.subscriptionId = moment().add(1, 'M').unix();
            }
        } else {
            customer.subscriptionId = session.subscription;
            const subscription = await customer.retrieveSubscription();
            customer.planId = subscription.items.data[0].price.id;
            customer.updateCustomerMetadata({
                onetime: false,
                subscription_id: customer.subscriptionId,
                plan_id: customer.planId
            });
            //customer.insertStripeLog('Created a New Monthly Subscription.');
            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'New Subscription Created! 📋', '');
        }
        req.session.subscription_id = customer.subscriptionId;
        customer.updateDbRecord();
        user.assigned = await user.assignRole(guild.donorRole);
        if (user.assigned) {
            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
        }
        user.sendMessage(guild.welcome_channel, config.donor_welcome_content.replace('%usertag%', '<@' + req.query.user_id + '>'));
    } else {
        console.error(`[MapJS] [${getTime()}] [routes/stripe.js] No Session retrieved after purchase.`, req.session);
    }
    res.redirect('/');
    return;
});

router.get('/renew', async function(req, res) {
    req.session.updated = 0;
    req.session.save();
    const customer = new StripeClient(req.session);
    const guild = await customer.identifyGuild();
    const session = await customer.retrieveSession(req.query.session_id);
    if (session) {
        customer.customerId = session.customer;
        req.session.customer_id = session.customer;
        customer.updateCustomerName(session.customer, session.client_reference_id);
        const record = await customer.fetchRecordByUser();
        const oldCustomer = new StripeClient(record);
        oldCustomer.deleteCustomer();
        const user = new DiscordClient(record);
        user.donorRole = guild.donorRole;
        if (!session.subscription || session.subscription === null) {
            customer.planId = req.session.onetime_id;
            if (Number.isInteger(parseInt(record.subscription_id))) {
                //customer.insertStripeLog('Received Renewal Payment for One Month Access.');
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'One Month Access Renewal! 📋', '');
                customer.subscriptionId = moment.unix(record.subscription_id).add(1, 'M').unix();
                customer.updateCustomerMetadata({
                    onetime: true,
                    expiration: customer.subscriptionId,
                    plan_id: customer.planId
                });
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'One Month Access Extended! 📋', '');
            } else {
                //customer.insertStripeLog('Received Payment for One Month Access.');
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'New One Month Access Payment! 📋', '');
                customer.subscriptionId = moment().add(1, 'M').unix();
            }
        }
        req.session.subscription_id = customer.subscriptionId;
        customer.updateDbRecord();
        user.assigned = await user.assignRole(guild.donorRole);
        if (user.assigned) {
            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
        }
    } else {
        console.error(`[MapJS] [${getTime()}] [routes/stripe.js] No Session retrieved after purchase.`, req.session);
    }
    res.redirect('/');
    return;
});


router.get('/cardupdate', async function(req, res) {
    req.session.perms = false;
    req.session.save();
    console.log('1');
    if (!req.query) {
        res.redirect('/account');
        return;
    }
    const customer = new StripeClient(req.query);
    const guild = await customer.identifyGuild();
    const session = await customer.retrieveSession();
    customer.customerId = session.customer;
    const record = await customer.fetchRecordByCustomer();
    const user = new DiscordClient(record);
    user.donorRole = guild.donorRole;
    const intent = await customer.retrieveSetupIntent(session.setup_intent);
    await customer.updatePaymentMethod(intent.customer, record.subscription_id, intent.payment_method);
    user.assigned = await user.assignRole(guild.donorRole);
    if (user.assigned) {
        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
    }
    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Customer Card Updated ✏', '');
    res.redirect('/account');
    return;
});

router.get('/cancel', async function(req, res) {
    const customer = new StripeClient(req.query);
    const record = await customer.fetchRecordByCustomer();
    const user = new DiscordClient(record);
    customer.setClientInfo(record);
    const guild = await customer.identifyGuild();
    const cancelled = await customer.cancelSubscription();
    if (cancelled) {
        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Subscription Cancelled 📝', '');
    } else {
        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Error Cancelling Subscription', '');
    }
    res.redirect('/account');
    return;
});

router.get('/reactivate', async function(req, res) {
    const customer = new StripeClient(req.session);
    const record = await customer.fetchRecordByUser(); 
    const user = new DiscordClient(record);
    customer.setClientInfo(record);
    const guild = await customer.identifyGuild();
    const reactivated = await customer.reactivateSubscription();
    if (reactivated) {
        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Subscription Re-Activated 📝', '');
    } else {
        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Error Cancelling Subscription', '');
    }
    res.redirect('/account');
    return;
});


router.post('/webhook', bodyParser.raw({
    type: 'application/json'
}), async (webhook, res) => {
    try{
        setTimeout(async () => {
            webhook = webhook.body;
            //console.log(webhook);
            const customer = new StripeClient({ customer_id: webhook.data.object.customer });
            const record = await customer.fetchRecordByCustomer();
            if (record) {
                const user = new DiscordClient(record);
                customer.setClientInfo(record);
                const guild = await customer.identifyGuild(record);
                user.setGuildInfo(guild);
    
    
                if (webhook.type === 'charge.succeeded') {
                    console.log(`[MapJS] [${getTime()}] [routes/stripe.js] Received Successful Charge webhook for ${customer.userName} (${customer.customerId}).`);
                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$' + parseFloat(webhook.data.object.amount / 100).toFixed(2) + '**');
                    user.assigned = await user.assignRole(guild.donorRole);
                    if (user.assigned) {
                        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
                    }
    
    
                } else if (webhook.type === 'customer.subscription.deleted') {
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Subscription Deleted 📉', '');
                    user.sendDmEmbed('FF0000', 'Your PokeMap Subscription has Ended 😭', `Sorry to see you go! If you did't like the subscription model, we offer single month payments that are non-recurring. Visit ${guild.domain}/subscribe to check it out!`);
                    customer.deleteCustomer();
                    customer.clearDbRecord();
                    user.removed = await user.removeDonorRole();
                    if (user.removed) {
                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                    }

                } else if (webhook.type === 'customer.deleted') {
                    customer.clearDbRecord();
                    user.removed = await user.removeDonorRole();
                    if (user.removed) {
                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                    }
                
    
                } else if (webhook.type === 'invoice.payment_failed') {
                    const charge = await customer.retrieveCharge(webhook.data.object.charge);
                    if (webhook.data.object.attempt_count < 5) {
                        if (webhook.data.object.attempt_count) {
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Payment Failed ⛔', 'Reason: ' + charge.failure_message + '\nAttempt Count: **' + webhook.data.object.attempt_count + '** of **5**');
                        } else {
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Payment Failed ⛔', 'Reason: ' + charge.failure_message);
                        }
                        user.removed = await user.removeDonorRole();
                        if (user.removed) {
                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Removed! 📝', '');
                        }
                        const message = 'Uh Oh! Your Donor Payment failed to ' + guild.name + '. \n' +
                                        'Reason From Bank: `' + charge.failure_message + '` \n' +
                                        'This was attempt: ' + webhook.data.object.attempt_count + '/5. \n\n' +
                                        'Please visit ' + guild.domain + '/account to update or change your payment information. \n';
                        if (webhook.data.object.attempt_count && webhook.data.object.attempt_count != 5) {
                            user.sendDmEmbed('FF0000', 'Subscription Payment Failed! ⛔', message);
                        } else {
                            user.sendDmEmbed('FF0000', 'Subscription Payment Failed! ⛔', message);
                        }
                    }
                }
            }
            res.sendStatus(200);
            return;
        }, 5000);

    } catch(e) {
        console.error(e);
    } 
});

function getTime (type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('hh:mmA');
    }
}

module.exports = router;
