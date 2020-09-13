'use strict';

const express = require('express');
const axios = require('axios');
const router = express.Router();
const bodyParser = require('body-parser');

const defaultData = require('../data/default.js');

const DiscordClient = require('../services/discord.js');
//const utils = require('../services/utils.js');

const config = require('../configs/stripe.json');

const catchAsyncErrors = fn => ((req, res, next) => {
    const routePromise = fn(req, res, next);
    if (routePromise.catch) {
        routePromise.catch(err => next(err));
    }
});

router.get('/subscribe', (req, res) => {

    let url = req.protocol + '://' + req.get('host') + req.originalUrl,
        discord = false,
        session = false;

    for(let d = 0, dlen = config.discords.length; d < dlen; d++){
        discord = url.indexOf(config.discords[d].subdomain) ? config.discords[d] : false;
    }
    if(discord){

        let user_found = db.query(`
            SELECT
                *
            FROM
                stripe_users
            WHERE
                user_id = '${req.session.user_id}';
        `);
        if(user_found && user_found[0]){

            const user = new StripeCustomer(
                req.session.user_id,
                req.session.username,
                req.session.email,
                req.protocol + '://' + req.get('host'),
                discord.plan_id,
                user_found[0].cust_id ? user_found[0].cust_id : null,
                user_found[0].sub_id ? user_found[0].sub_id : null,
            );

            console.log(StripeCustomer.customerID + ' ' + StripeCustomer.subscriptionID);

            if(StripeCustomer.customerID && StripeCustomer.subscriptionID){

                let session = await StripeCustomer.createSession();
                
                if (session.status == 'error') {
                    console.error(session.error);
                    res.render(__dirname + '/html/generalError.html');

                } else {
                    res.render(__dirname + '/html/modify.html', {
                        map_name: (discord.name + 'PokéMap'),
                        key: config.live_pk,
                        plan: discord.plan_id,
                        user_id: user.user_id,
                        user_name: user.user_name,
                        email: user.email,
                        session: session.id
                    });
                }

            } else {
                res.render(__dirname + '/html/subscribe.html', {
                    map_name: (discord.name + 'PokéMap'),
                    key: config.live_pk,
                    plan: discord.plan_id,
                    user_id: user.user_id,
                    user_name: user.user_name,
                    email: user.email,
                    amt: 499
                });
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
            res.redirect('/subscribe');
        }

    } else {
        console.error('[routes/stripe.js] No matching discord for ' + req.protocol + '://' + req.get('host'));
        res.redirect('/discordError');
    }
});


router.get('/account', (req, res) => {
    res.render('account', defaultData);
});


router.post('/stripe', bodyParser.raw({
    type: 'application/json'
}), (webhook, res) => {
    res.sendStatus(200);
    
});


router.get('/discordError', (req, res) => {
    return res.render(__dirname + '/html/generalError.html');
});

router.get('/stripeError', (req, res) => {
    return res.render(__dirname + '/html/generalError.html');
});

module.exports = router;
