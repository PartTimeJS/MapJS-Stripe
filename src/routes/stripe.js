/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');

const defaultData = require('../data/default.js');

const config = require('../services/config.js');
const discords = require('../configs/discords.json').discords;

const StripeClient = require('../services/stripe.js');
const DiscordClient = require('../services/discord.js');

// const catchAsyncErrors = fn => ((req, res, next) => {
//     const routePromise = fn(req, res, next);
//     if (routePromise.catch) {
//         routePromise.catch(err => next(err));
//     }
// });

router.get('/subscribe', async (req, res) => {
    let discord = false;
    if(discord.length > 1){
        for(let d = 0, dlen = discords.length; d < dlen; d++){
            if(req.get('host').includes(discords[d].subdomain + '.')){
                discord = discords[d]; break;
            }
        }
    } else { 
        discord = discords[0];
    }
    if(discord){
        const user = new StripeClient({ user_id: req.session.user_id });
        const record = await user.findRecordByUser();
        req.session.map_name = record.map_name;
        req.session.key = discord.test_pk ? discord.test_pk : config.stripe.live_pk;
        req.session.map_url = req.protocol + '://' + req.get('host');
        req.session.plan_id = discord.plan_id;
        req.session.amt = discord.plan_cost;
        req.session.donor_role = discord.role;
        if(record){
            req.session.customer_id = record.customer_id ? record.customer_id : false;
            req.session.subscription_id = record.subscription_id ? record.subscription_id : false;
            user.setClientInfo(record);
            if(user.customerID && user.subscriptionID){
                req.session.session_id = await user.createSession();
                if(req.session.session_id.error){
                    res.render('generalError.html', req.session);
                } else {
                    res.render('account', req.session);
                }
            } else {
                res.render('subscribe', req.session);
            }
        } else {
            user.setClientInfo(record);
            user.insertDbRecord();
            res.redirect('/api/stripe/subscribe');
        }
    } else {
        console.error(`[MapJS] [routes/stripe.js] No matching discord for https://${req.get('host')}`);
        res.redirect('/discordError');
    }
});


router.get('/account', (req, res) => {
    res.render('account', defaultData);
});


router.get('/discordError', (req, res) => {
    return res.render(__dirname + '/html/generalError.html');
});


router.get('/stripeError', (req, res) => {
    return res.render(__dirname + '/html/generalError.html');
});


router.post('/webhook', bodyParser.raw({
    type: 'application/json'
}), async (webhook, res) => {
    res.sendStatus(200);

    if(webhook.type === 'charge.succeeded'){
        setTimeout(async () => {
            const cs_customer = new StripeClient({ 
                customer_id: webhook.data.object.customer 
            });
            const cs_record = cs_customer.fetchRecordByCustomer();
            const cs_user = new DiscordClient(cs_record);
            const cs_guild = await cs_user.identifyGuild(cs_record);
            console.log('[MapJS] [' + getTime('stamp') + '] [routes/stripe.js] Received Successful Charge webhook for ' + cs_user.userName + ' (' + cs_customer.id + ').');
            if (cs_guild.stripe_log_channel) {
                cs_user.sendChannelEmbed(cs_guild.stripe_log_channel, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$' + parseFloat(webhook.data.object.amount / 100).toFixed(2) + '**');
            }
            cs_user.donorRole = cs_guild.role;
            const cs_assigned = await cs_user.assignDonorRole();
            if(cs_assigned && cs_guild.stripe_log_channel){
                cs_user.sendChannelEmbed(cs_guild.stripe_log_channel, '00FF00', 'Donor Role Assigned 📝', '');
            }
        }, 5000);
        // END 
        return;

    } else if (webhook.type === 'customer.subscription.cancelled'){
        const sc_customer = new StripeClient({ 
            customer_id: webhook.data.object.customer 
        });
        const sc_record = await sc_customer.fetchRecordByCustomer();
        sc_customer.setClientInfo(sc_record);
        sc_customer.deleteCustomer();
        sc_customer.clearDbRecord();
        const sc_user = new DiscordClient(sc_record);
        const sc_guild = await sc_user.identifyGuild(sc_record);
        if (sc_guild.stripe_log_channel) {
            sc_user.sendChannelEmbed(sc_guild.stripe_log_channel, 'FF0000', 'Subscription Deleted 📉', '');
        }
        sc_user.donorRole = sc_guild.role;
        const sc_removed = await sc_user.removeDonorRole();
        if(sc_removed && sc_guild.stripe_log_channel){
            sc_user.sendChannelEmbed(sc_guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
        }
        // END
        return;
    
    } else if (webhook.type ===  'charge.failed' || webhook.type === 'invoice.payment_failed'){
        const pf_customer = new StripeClient({ 
            customer_id: webhook.data.object.customer 
        });
        const pf_record = pf_customer.fetchRecordByCustomer();
        const pf_user = new DiscordClient(pf_record);
        const pf_guild = await pf_user.identifyGuild(pf_record);
        pf_user.donorRole = pf_guild.role;
        const pf_removed = await pf_user.removeDonorRole();
        if (pf_guild.stripe_log_channel) {
            pf_user.sendChannelEmbed(pf_user.userId, 'FF0000', 'Payment Failed ⛔', `Attempt Count: **${webhook.data.object.attempt_count}** of **5**`);
        }
        if (webhook.data.object.attempt_count != 5) {
            pf_user.sendDmEmbed('FF0000', 'Subscription Payment Failed! ⛔', `Uh Oh! Your Donor Payment failed to ${pf_guild.name}.\nThis was attempt ${webhook.data.object.attempt_count}/5. \nPlease visit ${pf_guild.domain}/subscribe to update your payment information.`);
        }
        if(pf_removed && pf_guild.stripe_log_channel){
            pf_user.sendChannelEmbed(pf_guild.stripe_log_channel, '00FF00', 'Donor Role Assigned! 📝', '');
        }
        // END
        return;
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
