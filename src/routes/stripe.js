'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();
const bodyParser = require('body-parser');

const defaultData = require('../data/default.js');

const config = require('../configs/stripe.json');

const StripeClient = require('../services/stripe.js');
//const utils = require('../services/utils.js');

const MySQLConnector = require('../services/mysql.js');
const db = new MySQLConnector(config.db);

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});

router.get('/subscribe', async (req, res) => {

    let discord = false;

    for(let d = 0, dlen = config.discords.length; d < dlen; d++){
        if(req.get('host').includes(config.discords[d].subdomain + ".")){
            discord = config.discords[d]; break;
        }
    }

    if(discord){

        let user_found = await db.query(`
            SELECT
                *
            FROM
                stripe_users
            WHERE
                user_id = '${req.session.user_id}';
        `);

        req.session.map_name = (discord.name + 'PokéMap');
        req.session.key = discord.test_pk ? discord.test_pk :config.stripe.live_pk;
        req.session.map_url = req.protocol + '://' + req.get('host');
        req.session.plan_id = discord.plan_id;
        req.session.amt = discord.plan_cost;

        if(user_found && user_found[0]){

            req.session.customer_id = user_found[0].cust_id ? user_found[0].cust_id : null;
            req.session.subscription_id = user_found[0].sub_id ? user_found[0].sub_id : null;    

            const StripeCustomer = new StripeClient(req.session);

            console.log(StripeCustomer);

            if(StripeCustomer.customerID && StripeCustomer.subscriptionID){

                req.session.session_id = await StripeCustomer.createSession();

                req.session.subscription = await StripeCustomer.getSubscription();

                if (session.status == 'error') {
                    console.error(session.error);
                    res.render('generalError.html', req.session);
                } else {
                    res.render('account', req.session);
                }

            } else {

                res.render('subscribe', req.session);
            }

        } else {
            let user_insert = `
                INSERT IGNORE INTO stripe_users (
                        user_id,
                        user_name,
                        email,
                        plan_id
                    ) 
                VALUES 
                    (
                        '${req.session.user_id}', 
                        '${req.session.username}', 
                        '${req.session.email}',
                        '${discord.plan_id}'
                    );
            `;
            await db.query(user_insert);
            console.log('redirecting back to subscribe')
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
}), (webhook, res) => {
    res.sendStatus(200);

    let data = "",
        member = "",
        customer = "";  

    switch (webhook.type) {

        case 'charge.succeeded':
            data = await db.query(`
                SELECT
                    *
                FROM
                    oauth_users
                WHERE
                    stripe_id = ${webhook.data.object.customer};
            `);
            let user 
            if(user.length > 1){
                console.error('[routes/stripe.js] Saw multiple users returned from the user query',user);
            }
            if(user){
                user = user[0];
                let user = await bot.users.fetch(user.user_id);
                console.log('[' + bot.getTime('stamp') + '] [routes/stripe.js] Received Successful Charge webhook for ' + user.tag + ' (' + customer.id + ').');
                if (config.stripe_log) {
                  bot.sendEmbed(member, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$' + parseFloat(webhook.data.object.amount / 100).toFixed(2) + '**', config.stripe_log_channel);
                }
            } else {
                console.error('[routes/stripe.js] No user returned from the user query',user);
            }
            
            // END 
            return;
  
        case 'customer.subscription.deleted':
            customer = await object.customer.fetch(webhook.data.object.customer);
            member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.name.split(' - ')[1]);
            switch (true) {
                case !member:
                return;
                case webhook.data.object.plan.id != config.STRIPE.plan_id:
                return;
                default:
                console.log('[' + bot.getTime('stamp') + '] [stripe.js] Received Deleted Subcscription webhook for ' + customer.name.split(' - ')[0] + ' (' + webhook.data.object.customer + ').');
                bot.removeDonor(customer.name.split(' - ')[1]);
                object.customer.delete(webhook.data.object.customer);
                if (config.stripe_log) {
                    bot.sendEmbed(member, 'FF0000', 'Subscription Deleted! ⚰', '', config.stripe_log_channel);
                }
                database.runQuery(
                    `UPDATE
                        oauth_users
                    SET
                        stripe_id = NULL,
                        plan_id = NULL,
                        sub_id = NULL
                    WHERE
                        user_id = ${customer.name.split(' - ')[1]};`
                );
            }
            return;
    
            case 'invoice.payment_failed':
            //------------------------------------------------------------------------------
            //   PAYMENT FAILED WEBHOOK
            //------------------------------------------------------------------------------
            customer = await object.customer.fetch(webhook.data.object.customer);
            member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.name.split(' - ')[1]);
            console.log('[' + bot.getTime('stamp') + '] [stripe.js] Received Payment Failed webhook for ' + user.tag + ' (' + customer.id + ').');
            bot.removeDonor(member.id);
            if (config.stripe_log) {
                bot.sendEmbed(member, 'FF0000', 'Payment Failed! ⛔', 'Attempt Count: **' + webhook.data.object.attempt_count + '** of **5**', config.stripe_log_channel);
            }
            if (webhook.data.object.attempt_count != 5) {
                bot.sendDM(member, 'Subscription Payment Failed! ⛔', 'Uh Oh! Your Donor Payment failed to ' + config.map_name + '.\nThis was attempt ' + webhook.data.object.attempt_count + '/5. \nPlease visit ' + config.map_url + '/subscribe to update your payment information.', 'FF0000');
            }
            return;
        }
    });



module.exports = router;
