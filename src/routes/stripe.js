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

                

                //req.session.next_payment = subscription.

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


    
});



module.exports = router;
