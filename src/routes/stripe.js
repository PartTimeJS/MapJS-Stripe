/* eslint-disable no-async-promise-executor */
/* global BigInt */
'user strict';

const moment = require('moment');
const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');

const defaultData = require('../data/default.js');

const config = require('../configs/stripe.json');
const discords = require('../configs/discords.json').discords;

const StripeClient = require('../services/stripe.js');
const DiscordClient = require('../services/discord.js');

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});

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
        const found = await user.findRecordByUser();
        req.session.map_name = (discord.name + 'PokéMap');
        req.session.key = discord.test_pk ? discord.test_pk : config.stripe.live_pk;
        req.session.map_url = req.protocol + '://' + req.get('host');
        req.session.plan_id = discord.plan_id;
        req.session.amt = discord.plan_cost;
        if(found){
            req.session.customer_id = found.customer_id ? found.customer_id : false;
            req.session.subscription_id = found.subscription_id ? found.subscription_id : false;
            await user.setUserData(req.session);
            console.log('user',user);
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
            await user.setUserData(req.session);
            user.insertDbRecord();
            res.redirect('/api/stripe/subscribe');
        }
    } else {
        console.error('[routes/stripe.js] No matching discord for ' + req.protocol + '://' + req.get('host'));
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
        setTimeout(() => {
            const cs_customer = new StripeClient({ 
                customer_id: webhook.data.object.customer 
            });
            const cs_record = cs_customer.fetchRecordByCustomer();
            const cs_user = new DiscordClient(cs_record);
            console.log('[' + getTime('stamp') + '] [routes/stripe.js] Received Successful Charge webhook for ' + user.tag + ' (' + customer.id + ').');
            if (config.stripe_log) {
                cs_user.sendChannelEmbed('00FF00', 'Payment Successful! 💰 ', 'Amount: **$' + parseFloat(webhook.data.object.amount / 100).toFixed(2) + '**', config.stripe_log_channel);
            }
        }, 5000);
        // END 
        return;

    } else if (webhook.type === 'customer.subscription.deleted'){
        const sd_customer = new StripeClient({ 
            customer_id: webhook.data.object.customer 
        });
        const sd_record = await sd_customer.fetchRecordByCustomer();
        sd_customer.setUserData(sd_record);
        sd_customer.deleteCustomer();
        sd_customer.clearDbRecord();
        const sd_user = new DiscordClient(sd_record);
        sd_user.removeDonor();
        if (config.stripe_log) {
            sd_user.sendChannelEmbed('FF0000', 'Subscription Deleted! ⚰', '', config.stripe_log_channel);
        }
        // END
        return;

    } else if (webhook.type === 'customer.subscription.cancelled'){
        // const sd_customer = new StripeClient({ 
        //     customer_id: webhook.data.object.customer 
        // });
        // const sd_record = await sd_customer.fetchRecordByCustomer();
        // sd_customer.setUserData(sd_record);
        // sd_customer.deleteCustomer();
        // sd_customer.clearDbRecord();
        // const sd_user = new DiscordClient(sd_record);
        // sd_user.removeDonor();
        // if (config.stripe_log) {
        //     sd_user.sendChannelEmbed('FF0000', 'Subscription Deleted! ⚰', '', config.stripe_log_channel);
        // }
        // // END
        // return;
    
    } else if (webhook.type === 'invoice.payment_failed'){
        const pf_customer = new StripeClient({ 
            customer_id: webhook.data.object.customer 
        });
        const pf_record = await pf_customer.fetchRecordByCustomer();
        const pf_user = new DiscordClient(pf_record);
        pf_user.removeDonor();
        if (config.stripe_log) {
            pf_user.sendChannelEmbed('FF0000', 'Payment Failed! ⛔', 'Attempt Count: **' + webhook.data.object.attempt_count + '** of **5**', config.stripe_log_channel);
        }
        if (webhook.data.object.attempt_count != 5) {
            pf_user.sendDirectMessageEmbed('FF0000', 'Subscription Payment Failed! ⛔', 'Uh Oh! Your Donor Payment failed to ' + config.map_name + '.\nThis was attempt ' + webhook.data.object.attempt_count + '/5. \nPlease visit ' + config.map_url + '/subscribe to update your payment information.');
        }
        // END
        return;
    }
});



module.exports = router;
