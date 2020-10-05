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
const guildClient = require('../services/discord.js');
const DiscordClient = require('../services/discord.js');

// const catchAsyncErrors = fn => ((req, res, next) => {
//     const routePromise = fn(req, res, next);
//     if (routePromise.catch) {
//         routePromise.catch(err => next(err));
//     }
// });

router.get('/subscribe', async (req, res) => {
    let guild = false;
    if(guilds.length > 1){
        for(let d = 0, dlen = guilds.length; d < dlen; d++){
            if(`https://${req.get('host')}`.includes(guilds[d].domain)){
                guild = guilds[d]; break;
            }
        }
    } else { 
        guild = guilds[0];
    }
    if(guild){
        const customer = new StripeClient(req.session);
        const record = await customer.fetchRecordByUser();

        req.session.map_name = guild.name;
        req.session.key = guild.test_pk ? guild.test_pk : config.stripe.live_pk;
        req.session.map_url = `https://${req.get('host')}`;
        req.session.recurring_id = guild.recurring_id;
        req.session.onetime_id = guild.onetime_id;
        req.session.amt1 = guild.recurring_cost;
        req.session.amt2 = guild.onetime_cost;
        req.session.donor_role = guild.role;

        if(!req.session.user_id){
            return res.redirect('/login');
        }

        const data =  Object.assign({}, defaultData, req.session);

        if(record){
            req.session.customer_id = record.customer_id ? record.customer_id : false;
            req.session.subscription_id = record.subscription_id ? record.subscription_id : false;
            customer.setClientInfo(record);
            if(customer.customerID && customer.subscriptionID){
                req.session.session_id = await customer.createSession();
                if(req.session.session_id.error){
                    res.render('generalError.html', data);
                } else {
                    res.redirect('/account');
                }
            } else {
                res.render('subscribe', data);
            }
        } else {
            customer.insertDbRecord();
            res.redirect('/subscribe');
        }
    } else {
        console.error(`[MapJS] [routes/stripe.js] No matching guild for https://${req.get('host')}`);
        res.redirect('/guildError');
    }
});


router.get('/account', (req, res) => {
    res.render('account', defaultData);
});


router.get('/error', (req, res) => {
    res.render('error', defaultData);
});

router.get('/success', async function(req, res) {
    const customer = new StripeClient(req.query);
    const guild = await customer.identifyGuild();
    const session = await customer.retrieveSession();
    const record = await customer.fetchRecordByCustomer();
    const user = new DiscordClient(record);
    customer.customerId = session.customer;
    console.log('/success - session', req.session);
    customer.updateCustomerName(session.customer, session.client_reference_id);
    if(!session.subscription || session.subscription === null){
        customer.subscriptionId = moment().unix() + 2592000;
    } else {
        customer.subscriptionId = session.subscription;
    }
    console.log('/success - StripeClient', customer);
    customer.insertDbRecord();
    console.log('/success - DiscordClient', user);
    user.assignDonorRole();
    if(user.assigned){
        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
    } 
    user.sendMessage(guild.welcome_channel, config.donor_welcome_content.replace('%usertag%', '<@' + req.query.user_id + '>'));
    user.sendChannelEmbed(guild.stripe_log_channel, 'New Subscription Created! 📋', '');
    res.redirect('/');
    return;
});


router.get('/updatesuccess', async function(req, res) {
    const customer = new StripeClient(req.query);
    const guild = await customer.identifyGuild();
    const session = await customer.retrieveSession();
    const record = await customer.fetchRecordByCustomer();
    const user = new DiscordClient(record);
    customer.customerId = session.customer;
    const intent = await customer.retrieveSetupIntent(session.setup_intent);
    await customer.updatePaymentMethod(intent.customer, record.plan_id, intent.payment_method);
    user.assigned = await user.assignDonorRole();
    if(user.assigned){
        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
    }
    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Customer Card Updated ✏', '');
    res.redirect(config.map_url);
    return;
});


router.post('/webhook', bodyParser.raw({
    type: 'application/json'
}), async (webhook, res) => {
    try{
        setTimeout(async () => {
            webhook = webhook.body;
            if(!webhook.data.object.customer_name){
                console.log(webhook);
            }
            const customer = new StripeClient({ customer_id: webhook.data.object.customer });
            const record = await customer.fetchRecordByCustomer();
            const user = new DiscordClient(record);
            customer.setClientInfo(record);
            const guild = await customer.identifyGuild(record);
            customer.setGuildInfo(guild);
            user.setGuildInfo(guild);


            if(webhook.type === 'charge.succeeded'){
                console.log(`[MapJS] [${getTime('stamp')}] [routes/stripe.js] Received Successful Charge webhook for ${customer.userName} (${customer.customerId}).`);
                user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$' + parseFloat(webhook.data.object.amount / 100).toFixed(2) + '**');
                user.assigned = await user.assignDonorRole();
                if(user.assigned){
                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
                }


            } else if (webhook.type === 'customer.subscription.cancelled'){
                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Subscription Deleted 📉', '');
                customer.deleteCustomer();
                customer.clearDbRecord();
                user.removed = await user.removeDonorRole();
                if(user.removed){
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                }
            

            } else if (webhook.type ===  'charge.failed' || webhook.type === 'invoice.payment_failed'){
                if(webhook.data.object.attempt_count){
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Payment Failed ⛔', `Attempt Count: **${webhook.data.object.attempt_count}** of **5**`);
                } else {
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Payment Failed ⛔', webhook.data.object.failure_message);
                }
                user.removed = await user.removeDonorRole();
                if(user.removed){
                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Removed! 📝', '');
                }
                const message = 'Uh Oh! Your Donor Payment failed to ' + guild.name + '. \n' +
                                'Reason: `' + webhook.data.object.failure_message + '` \n\n' +
                                'This was attempt ' + webhook.data.object.attempt_count + '/5. \n' +
                                'Please visit ' + guild.domain + '/account to update your payment information. \n';
                if (webhook.data.object.attempt_count && webhook.data.object.attempt_count != 5) {
                    user.sendDmEmbed('FF0000', 'Subscription Payment Failed! ⛔', message);
                } else {
                    user.sendDmEmbed('FF0000', 'Subscription Payment Failed! ⛔', message);
                }
            }


            res.sendStatus(200);
            return;
        }, 5000);

    } catch(e){
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
