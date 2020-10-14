/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const config = require('./config.js');
const guilds = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.stripe.db);

const stripe = require('stripe')(config.stripe.live_sk);

class StripeClient {

    constructor(user) {
        this.userId = user.user_id;
        this.userName = user.user_name;
        this.guildId = user.guild_id;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.email = user.email;
        this.mapUrl = user.map_url;
        this.planId = user.plan_id ? user.plan_id : null;
        this.customerId = user.customer_id ? user.customer_id : null;
        this.subscriptionId = user.subscription_id ? user.subscription_id : null;
        this.ipAddress = user.ip_address;
        this.sessionId = user.session_id;
        this.accessToken = user.access_token ? user.access_token : null;
        this.refreshToken = user.refresh_token ? user.refresh_token : null;
        return;
    }

    setClientInfo(userInfo) {
        this.userId = userInfo.user_id;
        this.userName = userInfo.user_name;
        this.guildId = userInfo.guild_id;
        this.guildName = userInfo.guild_name;
        this.donorRole = userInfo.donor_role;
        this.email = userInfo.email;
        this.mapUrl = userInfo.map_url;
        this.planId = userInfo.plan_id ? userInfo.plan_id : null;
        this.customerId = userInfo.customer_id ? userInfo.customer_id : null;
        this.subscriptionId = userInfo.subscription_id ? userInfo.subscription_id : null;
        this.ipAddress = userInfo.ip_address;
        this.accessToken = userInfo.access_token ? userInfo.access_token : null;
        this.refreshToken = userInfo.refresh_token ? userInfo.refresh_token : null;
        return;
    }

    setGuildInfo(guildInfo){
        this.guildId = !guildInfo.id ? this.guildId : guildInfo.id;
        this.guildName = !guildInfo.name ? this.guildName : guildInfo.name;
        this.donorRole = guildInfo.role;
        this.mapUrl = guildInfo.domain;
        return;
    }

    setSubscriptionID(subscription_id) {
        this.subscriptionId = subscription_id;
    }

    setCustomerID(customer_id) {
        this.customerId = customer_id;
    }

    createSession() {
        return new Promise((resolve) => {
            stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'setup',
                customer: this.customerId,
                setup_intent_data: {
                    metadata: {
                        plan_id: this.planId,
                        subscription_id: this.subscriptionId
                    },
                },
                success_url: this.mapUrl + `/cardupdate?session_id={CHECKOUT_SESSION_ID}&customer_id=${this.customerId}`,
                cancel_url: this.mapUrl + '/account',
            },
            function (error, session) {
                if (error) {
                    return resolve({
                        status: 'error',
                        error: error
                    });
                }
                this.sessionId = session.id;
                return resolve(session);
            });
        });
    }

    retrieveSession(session_id) {
        if(!session_id){
            session_id = this.sessionId;
        }
        return new Promise(async function(resolve) {
            const session = await stripe.checkout.sessions.retrieve(session_id);
            return resolve(session);
        });
    }

    retrieveSetupIntent(setup_intent) {
        return new Promise(async function (resolve) {
            let intent = await stripe.setupIntents.retrieve(setup_intent);
            return resolve(intent);
        });
    }

    fetchCustomer() {
        return new Promise(async (resolve) => {
            let customerObject;
            await stripe.customers.retrieve(
                this.customerId,
                function (err, customer) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Fetching Customer.`, err.message);
                        return resolve(false);
                    } else {
                        customerObject = customer;
                        resolve(customer);
                    }
                }
            );
            this.customerObject = customerObject;
        });
    }

    retrieveCharge(charge_id) {
        return new Promise(async (resolve) => {
            const charge = await stripe.charges.retrieve(
                charge_id
            );
            return resolve(charge);
        });
    }

    updateCustomerName(customer_id, customer_name) {
        if(!customer_name){
            customer_name = (this.userName + ' - ' + this.userId);
        }
        if(!customer_id){
            customer_id = this.customerId;
        }
        stripe.customers.update(
            customer_id, {
                name: customer_name
            },
            function (err, customer) {
                if (err) {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Updating Customer Name.`, err.message);
                    return false;
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer.id}'s Name has been Updated.`);
                    return customer;
                }
            }
        );
    }

    updateCustomerDescription() {
        stripe.customers.update(
            this.customerId, {
                description: (this.userName + ' - ' + this.userId)
            },
            function (err, customer) {
                if (err) {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Updating Customer Description.`, err.message);
                    return false;
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${this.userName}'s (${this.customerId}) Description has been Updated.`);
                    return customer;
                }
            }
        );
    }

    updatePaymentMethod(cust_id, sub_id, payment_method) {
        stripe.customers.update(cust_id, {
            invoice_settings: {
                default_payment_method: payment_method,
            },
        });
        if (sub_id) {
            stripe.subscriptions.update(sub_id, {
                default_payment_method: payment_method,
            });
        }
    }

    insertDbRecord() {
        db.query(`
            INSERT INTO ${config.stripe.db.customer_table} (
                    user_id,
                    user_name,
                    email,
                    guild_id,
                    guild_name,
                    access_token,
                    refresh_token
                ) 
            VALUES (
                    '${this.userId}', 
                    '${this.userName}', 
                    '${this.email}',
                    '${this.guildId}',
                    '${this.guildName}',
                    '${this.accessToken}',
                    '${this.refreshToken}'
                )
            ON DUPLICATE KEY UPDATE
                user_name = '${this.userName}',
                access_token = '${this.accessToken}',
                refresh_token = '${this.refreshToken}';
        `).catch(err => {
            console.error('Failed to execute query in insertDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record Inserted/Updated for ${this.userName} (${this.userId}).`);
    }

    insertAccessLog(log) {
        db.query(`
            INSERT IGNORE INTO ${config.stripe.db.auth_log_table} (
                    time,
                    ip_address,
                    user_id,
                    email,
                    log,
                    domain,
                    timestamp
                ) 
            VALUES (
                    '${getTime('full')}', 
                    '${this.ipAddress}',
                    '${this.userId}',
                    '${this.email}',
                    '${log}',
                    '${this.mapUrl}',
                    '${moment().unix()}'
                );
        `).catch(err => {
            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Failed to execute query in insertDbRecord`, '\r\n:Error:', err);
        });
    }

    updateDbRecord() {
        db.query(`
            UPDATE
                ${config.stripe.db.customer_table}
            SET
                plan_id = '${this.planId}',
                subscription_id = '${this.subscriptionId}',
                customer_id = '${this.customerId}'
            WHERE
                user_id = '${this.userId}'
                    AND
                guild_id = '${this.guildId}';
        `).catch(err => {
            console.error('Failed to execute query in updateDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Updated.`);
    }

    updateLastLogin() {
        db.query(`
            UPDATE
                ${config.stripe.db.customer_table}
            SET
                last_login = '${this.planId}'
            WHERE
                user_id = '${this.userId}'
                    AND
                guild_id = '${this.guildId}';
        `).catch(err => {
            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Failed to execute query in updateLastLogin`, '\r\n:Error:', err);
        });
    }

    clearDbRecord() {
        db.query(`
            UPDATE
                ${config.stripe.db.customer_table}
            SET
                customer_id = NULL,
                plan_id = NULL,
                subscription_id = NULL
            WHERE
                customer_id = '${this.customerId}'
                    AND
                guild_id = '${this.guildId}';
        `).catch(err => {
            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Failed to execute query in clearDbRecord`, '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Cleared.`);
    }

    deleteDbRecord() {
        db.query(`
            DELETE FROM
                ${config.stripe.db.customer_table}
            WHERE
                user_id = '${this.userId}'
                    AND
                guild_id = '${this.guildId}';
        `).catch(err => {
            console.error('Failed to execute query in updateDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Deleted.`);
    }

    fetchAccountRecords() {
        return new Promise(async (resolve) => {
            let query = `
                SELECT 
                    *
                FROM 
                    ${config.stripe.db.customer_table}
                WHERE
                    user_id = '${this.userId}'
                        AND
                    customer_id is NOT NULL;
            `;
            const data = await db.query(query);
            if (data) {
                return resolve(data);
            } else {
                return resolve(false);
            }
        });
    }

    fetchRecordByUser() {
        return new Promise(async (resolve) => {
            const data = await db.query(`
                SELECT 
                    * 
                FROM 
                    ${config.stripe.db.customer_table}
                WHERE 
                    user_id = '${this.userId}'
                        AND
                    guild_id = '${this.guildId}';
            `);
            if (data) {
                return resolve(data[0]);
            } else {
                return resolve(false);
            }
        });
    }

    fetchRecordByCustomer() {
        return new Promise(async (resolve) => {
            const customer_id = this.customerId;
            const data = await db.query(`
                SELECT 
                    * 
                FROM 
                    ${config.stripe.db.customer_table} 
                WHERE 
                    customer_id = '${customer_id}';
            `);
            if (data) {
                return resolve(data[0]);
            } else {
                return resolve(false);
            }
        });
    }

    deleteCustomer() {
        return new Promise((resolve) => {
            const customer_id = this.customerId;
            stripe.customers.del(
                customer_id,
                function (err) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Deleting Customer ${customer_id}.`, err.message);
                        return resolve(false);
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer_id} has been Deleted.`);
                        return resolve(true);
                    }
                }
            );
        });
    }

    retrieveSubscription() {
        return new Promise(async (resolve) =>{
            const subscription = await stripe.subscriptions.retrieve(
                this.subscriptionId
            );
            return resolve(subscription);
        });
    }

    cancelSubscription() {
        return new Promise((resolve) => {
            const customer_id = this.customerId;
            const subscription_id = this.subscriptionId;
            stripe.subscriptions.update(
                subscription_id, {
                    cancel_at_period_end: true
                },
                function (err, confirmation) {
                    if (err) {
                        return resolve(false);
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer_id}'s subscription ${subscription_id} has been set to cancel at period end.`, confirmation);
                        return resolve(true);
                    }
                }
            );
        });
    }

    reactivateSubscription() {
        return new Promise((resolve) => {
            const customer_id = this.customerId;
            const subscription_id = this.subscriptionId;
            stripe.subscriptions.update(
                this.subscriptionId, {
                    cancel_at_period_end: false
                },
                function (err, confirmation) {
                    if (err) {
                        return resolve(false);
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer_id}'s subscription ${subscription_id} has been set to cancel at period end.`, confirmation);
                        return resolve(true);
                    }
                }
            );
        });
    }

    validateCustomer() {
        return new Promise(async (resolve) => {
            if(this.customerId === 'Lifetime'){
                return resolve(true);
            } else {
                if (!this.customerId || this.customerId === null || this.customerId === 'null') {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Customer ID Set in order to Validate.`, this);
                    return resolve(false);
                } else {
                    let customer = await this.fetchCustomer();
                    this.customerObject = customer;
                    switch(true) {
                        case !customer:
                        case customer.deleted == true:
                            return resolve(false);
                        default:
                            if(customer.subscriptions.data[0]){
                                this.subscriptionId = customer.subscriptions.data[0].id;
                            }
                            return resolve(true);
                    }
                }
            }
        });
    }
    
    validateSubscription() { 
        return new Promise(async (resolve) => {
            let customer = await this.fetchCustomer();
            this.customerObject = customer;
            switch(true){
                case !customer.subscriptions:
                case !customer.subscriptions.data[0]:
                case customer.subscriptions.data[0].status == 'past_due':
                    return resolve(false);
                default:
                    return resolve(true);
            }
        });
    }

    identifyGuild(data) {
        return new Promise((resolve) => {
            let guild;
            if(!data){
                data = this;
            }
            let plan_id = data.plan_id ? data.plan_id : data.planId;
            let guild_id = data.guild_id ? data.guild_id : data.guildId;
            for (let d = 0, dlen = guilds.length; d < dlen; d++) {
                if (guilds[d].name !== 'test') {
                    if (guild_id) {
                        if (guilds[d].id === guild_id) {
                            guild = guilds[d];
                        }
                    } else if (plan_id) {
                        if (guilds[d].recurring_id === plan_id) {
                            guild = guilds[d];
                        }
                        if (guilds[d].onetime_id === plan_id) {
                            guild = guilds[d];
                        }
                        if (guilds[d].alt_plan_id === plan_id) {
                            guild = guilds[d];
                        }
                    }
                }
            }
            if(guild){
                this.donorRole = guild.role;
                this.guildId = guild.id;
                this.guildName = guild.name;
                this.mapUrl = guild.domain;
                return resolve(guild);
            } else {
                return resolve(false);
            }
        });
    }
}

const customer_table = `
    CREATE TABLE IF NOT EXISTS ${config.stripe.db.customer_table}(
        user_id varchar(40) NOT NULL,
        user_name varchar(40) NOT NULL,
        guild_id varchar(40) NOT NULL,
        guild_name varchar(50) NOT NULL,
        plan_id varchar(50),
        customer_id varchar(50),
        subscription_id varchar(50),
        email varchar(40),
        access_token varchar(60),
        refresh_token varchar(60),
        last_login varchar(20),
        PRIMARY KEY (user_id, guild_id) USING BTREE
    )`;
db.query(customer_table).catch(err => {
    console.error('Failed to execute query:', customer_table, '\r\n:Error:', err);
});

const auth_log_table = `
    CREATE TABLE IF NOT EXISTS ${config.stripe.db.auth_log_table}(
        time varchar(40) NOT NULL,
        ip_address varchar(30) NOT NULL,
        user_id varchar(40) NOT NULL,
        email varchar(50) NOT NULL,
        log varchar(255) NOT NULL,
        domain varchar(50) NOT NULL,
        timestamp bigint NOT NULL,
        PRIMARY KEY (timestamp, user_id) USING BTREE
    )`;
db.query(auth_log_table).catch(err => {
    console.error('Failed to execute query:', auth_log_table, '\r\n:Error:', err);
});

// const stripe_log_table = `
//     CREATE TABLE IF NOT EXISTS ${config.stripe.db.stripe_log_table}(
//         time varchar(40) NOT NULL,
//         ip_address varchar(30) NOT NULL,
//         customer_id varchar(40) NOT NULL,
//         user_name varchar(40) NOT NULL,
//         user_id varchar(40) NOT NULL,
//         email varchar(50) NOT NULL,
//         log varchar(255) NOT NULL,
//         timestamp bigint NOT NULL,
//         PRIMARY KEY (timestamp, user_id) USING BTREE
//     )`;
// db.query(stripe_log_table).catch(err => {
//     console.error('Failed to execute query:', stripe_log_table, '\r\n:Error:', err);
// });

function getTime(type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        default:
            return moment().format('hh:mmA');
    }
}

module.exports = StripeClient;

require('./stripe-audit.js');