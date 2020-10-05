/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const config = require('../configs/stripe.json');
const guilds = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.stripe.db);

const DiscordClient = require('./discord.js');

const stripe = require('stripe')(config.stripe.live_sk);
//const stripe = require('stripe')('sk_test_51BFqArHIrnCEspBZIahCA8TcdZKHOGD3YUd1qWbMGcoyLkvPo09sf2kNT9irUWlnGO6QiHgqSmqJ7d5OOTAsa2A400OldQIPgt');

class StripeClient {

    constructor(user) {
        this.userId = user.user_id;
        this.userName = user.user_name;
        this.guildId = user.guild_id;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.email = user.email;
        this.mapUrl = user.map_url;
        this.planId = user.plan_id;
        this.customerId = user.customer_id;
        this.subscriptionId = user.subscription_id;
        this.ipAddress = user.ip_address;
        this.sessionId = user.session_id;
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
        this.planId = userInfo.plan_id;
        this.customerId = userInfo.customer_id;
        this.subscriptionId = userInfo.subscription_id;
        this.ipAddress = userInfo.ip_address;
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
                success_url: this.mapUrl + `/updatesuccess?session_id={CHECKOUT_SESSION_ID}&plan_id=${this.planId}&user_id=${this.userId}&user_name=${this.userName}`,
                cancel_url: this.mapUrl + `/cancel?user_name=${this.userName}`,
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

    updateCustomerName() {
        stripe.customers.update(
            this.customerId, {
                name: (this.userName + ' - ' + this.userId)
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

    updateCustomerPayment(user_id, customer, token) {
        return new Promise((resolve) => {
            stripe.customers.update(
                customer.id, {
                    source: token
                },
                function (err, customer) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Updating Customer.`, err.message);
                        return resolve(false);
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer.id}'s Payment Method has been Updated.`);
                        db.query(`UPDATE ${config.stripe.db.customer_table} SET stripe_id = ${customer.id} WHERE user_id = ${this.userId} AND guild_id = ${this.guildId}`);
                        return resolve(customer);
                    }
                }
            );
        });
    }

    fetchCustomer() {
        return new Promise((resolve) => {
            let customerObject;
            stripe.customers.retrieve(
                this.customerId,
                function (err, customer) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Fetching Customer.`, err.message);
                        return resolve(false);
                    } else {
                        customerObject = customer;
                        return resolve(customer);
                    }
                }
            );
            this.customerObject = customerObject;
        });
    }


    insertDbRecord() {
        db.query(`
            INSERT INTO ${config.stripe.db.customer_table} (
                    user_id,
                    user_name,
                    email,
                    guild_id,
                    guild_name,
                    plan_id,
                    customer_id,
                    subscription_id
                ) 
            VALUES (
                    '${this.userId}', 
                    '${this.userName}', 
                    '${this.email}',
                    '${this.guildId}',
                    '${this.guildName}',
                    '${this.planId}',
                    '${this.customerId}',
                    '${this.subscriptionId}'
                )
            ON DUPLICATE KEY UPDATE
                customer_id = '${this.customerId}',
                subscription_id = '${this.subscriptionId}';

            ;
        `).catch(err => {
            console.error('Failed to execute query in insertDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Customer DB Record Inserted for ${this.userName} (${this.userId}).`);
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
            console.error('Failed to execute query in insertDbRecord', '\r\n:Error:', err);
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
            console.error('Failed to execute query in updateDbRecord', '\r\n:Error:', err);
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

    fetchRecordByUser() {
        return new Promise(async (resolve) => {
            let query = `
                SELECT 
                    * 
                FROM 
                    ${config.stripe.db.customer_table}
                WHERE 
                    user_id = '${this.userId}'
                        AND
                    guild_id = '${this.guildId}';
            `;
            const data = await db.query(query);
            if (data) {
                if (data.length > 1) {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] Deleting Redundant DB Record`, data[1]);
                    const customer = new StripeClient(data[1]);
                    customer.deleteDbRecord();
                }
                return resolve(data[0]);
            } else {
                return resolve(false);
            }
        });
    }

    fetchRecordByCustomer(customer_id) {
        return new Promise(async (resolve) => {
            if(!customer_id){
                customer_id = this.customerId;
            }
            const query = `
                SELECT 
                    * 
                FROM 
                    ${config.stripe.db.customer_table} 
                WHERE 
                    customer_id = '${customer_id}';`;
            const data = await db.query(query);
            if (data) {
                if (data.length > 1) {
                    let foundUser = false;
                    data.forEach(async (record) => {
                        const user = new DiscordClient(record);
                        const member = await user.checkIfMember(record.guild_id);
                        if (!member) {
                            foundUser = true;
                            console.error(`[MapJS] [${getTime()}] [services/stripe.js] Deleting DB Record with Invalid user_id`, record);
                            const customer = new StripeClient(record);
                            customer.deleteDbRecord();
                        }
                    });
                    if (foundUser) {
                        return resolve(resolve);
                    }
                } else {
                    return resolve(data[0]);
                }
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

    cancelSubscription() {
        return new Promise((resolve) => {
            stripe.subscriptions.update(
                this.subscriptionId, {
                    cancel_at_period_end: true
                },
                function (err, confirmation) {
                    if (err) {
                        return resolve(false);
                    } else {
                        return resolve(confirmation);
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
                    const customer = await this.fetchCustomer();
                    switch(true) {
                        case !customer:
                        case customer.deleted == true:
                            return resolve(false);
                        default:
                            if(customer.subscriptions.data[0]){
                                StripeClient.subscriptionId = customer.subscriptions.data[0].id;
                            }
                            return resolve(true);
                    }
                }
            }
        });
    }
    
    validateSubscription() { 
        return new Promise(async (resolve) => {
            let customer;
            if(this.customerObject){
                customer = this.customerObject;
            } else {
                customer = await this.fetchCustomer();
            }
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
            if(!data){
                data = this;
            }
            let plan_id = data.plan_id ? data.plan_id : data.planId;
            let guild_id = data.guild_id ? data.guild_id : data.guildId;
            for (let d = 0, dlen = guilds.length; d < dlen; d++) {
                if (guilds[d].name !== 'test') {
                    if (guild_id) {
                        if (guilds[d].id === guild_id) {
                            return resolve(guilds[d]);
                        }
                    } else if (plan_id) {
                        if (guilds[d].recurring_id === plan_id) {
                            return resolve(guilds[d]);
                        }
                        if (guilds[d].onetime_id === plan_id) {
                            return resolve(guilds[d]);
                        }
                        if (guilds[d].alt_plan_id === plan_id) {
                            return resolve(guilds[d]);
                        }
                    } else {
                        console.error(`Bad data received from ${data.source}.`, data);
                        return resolve(false);
                    }
                }
            }
            return resolve(false);
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