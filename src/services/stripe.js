/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const ontime = require('ontime');
const config = require('../configs/stripe.json');
const discords = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.stripe.db);

const DiscordClient = require('./discord.js');

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
        this.planId = user.plan_id;
        this.customerId = user.customer_id;
        this.subscriptionId = user.subscription_id;
        this.ipAddress = user.ip_address;
    }


    setClientInfo(user) {
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


    createCustomer() {
        return new Promise((resolve) => {
            stripe.customers.create({
                description: (this.userName + ' - ' + this.userId),
                email: this.email,
                source: this.accessToken
            }, function (err, customer) {
                if (err) {
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Creating Customer.`, err.message);
                    return resolve(false);
                } else {
                    this.customerId = customer.id;
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer.id} has been Created.`);
                    db.query(`UPDATE ${config.stripe.db.customer_table} SET stripe_id = ${customer.id} WHERE user_id = ${this.userId} AND guild_id = ${this.guildId}`);
                    return resolve(customer);
                }
            });
        });
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
            stripe.customers.retrieve(
                this.customerId,
                function (err, customer) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Fetching Customer.`, err.message);
                        return resolve(false);
                    } else {
                        return resolve(customer);
                    }
                }
            );
        });
    }


    insertDbRecord() {
        db.query(`
            INSERT IGNORE INTO ${config.stripe.db.customer_table} (
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
                );
        `).catch(err => {
            console.error('Failed to execute query in insertDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record Inserted for ${this.userName} (${this.userId}).`);
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
                user_id = '${this.userId}';
        `).catch(err => {
            console.error('Failed to execute query in updateDbRecord', '\r\n:Error:', err);
        });
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Updated.`);
    }


    deleteDbRecord() {
        db.query(`
            DELETE FROM
                ${config.stripe.db.customer_table}
            WHERE
                user_id = '${this.userId}'
                    AND
                guild_id = '${this.guildId}';
        `);
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Deleted.`);
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


    fetchRecordByCustomer() {
        return new Promise(async (resolve) => {
            const data = await db.query(`
                SELECT 
                    * 
                FROM 
                    ${config.stripe.db.customer_table} 
                WHERE 
                    customer_id = '${this.customerId}'
                        AND
                    guild_id = '${this.guildId}';
            `);
            if (data) {
                if (data.length > 1) {
                    let foundUser = false;
                    data.forEach(async (record) => {
                        const user = new DiscordClient(record);
                        const member = await user.checkIfMember(record.guild_id);
                        if (member) {
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
                console.log(`
                    SELECT 
                        * 
                    FROM 
                        ${config.stripe.db.customer_table} 
                    WHERE 
                        customer_id = '${this.customerId}'
                            AND
                        guild_id = '${this.guildId}';
                `);
                return resolve(false);
            }
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
                guild_id = '${this.guildId}';`);
        console.log(`[MapJS] [${getTime()}] [services/stripe.js] DB Record for ${this.userName} (${this.userId}) for guild_id ${this.guildId} has been Cleared.`);
    }


    deleteCustomer() {
        return new Promise((resolve) => {
            const customer_id = this.customerId;
            stripe.customers.del(
                customer_id,
                function (err, confirmation) {
                    if (err) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Deleting Customer ${customer_id}.`, err.message);
                        return resolve(false);
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer ${customer_id} has been Deleted.`);
                        return resolve(confirmation);
                    }
                }
            );
        });
    }


    // async createSubscription(customer, user_id) {
    //     return new Promise((resolve) => {
    //         stripe.subscriptions.create({
    //             customer: this.customerId,
    //             items: [{
    //                 plan: this.planId,
    //             }, ]
    //         }, function(err, subscription) {
    //             if (err) {
    //                 let object = {
    //                     title: 'ERROR',
    //                     message: err.message
    //                 }
    //                 console.error(`[MapJS] [${getTime()}] [services/stripe.js] Error Creating Subscription.', err.message);
    //                 return resolve(object);
    //             } else {
    //                 db.query('UPDATE ${config.stripe.db.customer_table} SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND guild_id = ?', [this.customerId, this.planId, this.userId, this.guildId]);
    //                 console.log(`[MapJS] [${getTime()}] [services/stripe.js] A New Stripe Subscription has been Created.`);
    //                 return resolve(subscription);
    //             }
    //         });
    //     });
    // }


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
                        case !customer.subscriptions:
                        case !customer.subscriptions.data[0]:
                        case customer.subscriptions.data[0].status == 'past_due':
                            return resolve(false);
                        default:
                            this.subscriptionId = customer.subscriptions.data[0].id;
                            return resolve(true);
                    }
                }
            }
        });
    }


    identifyDonorRole(data) {
        return new Promise((resolve) => {
            for (let d = 0, dlen = discords.length; d < dlen; d++) {
                if(discords[d].name !== 'test'){
                    if (data.plan_id) {
                        if (discords[d].plan_id === data.plan_id) {
                            return resolve(discords[d]);
                        }
                    } else if (data.guild_id) {
                        if (discords[d].id === data.guild_id) {
                            return resolve(discords[d]);
                        }
                    } else {
                        return resolve(false);
                    }
                }
            }
        });
    }


    identifyGuild(data) {
        return new Promise((resolve) => {
            for (let d = 0, dlen = discords.length; d < dlen; d++) {
                if (discords[d].name !== 'test') {
                    if (data.plan_id) {
                        if (discords[d].plan_id === data.plan_id) {
                            return resolve(discords[d]);
                        }
                    } else if (data.guild_id) {
                        if (discords[d].id === data.guild_id) {
                            return resolve(discords[d]);
                        }
                    } else {
                        console.error(`Bad data received from ${data.source}.`, data);
                        return resolve(false);
                    }
                }
            }
        });
    }
}


function identifyGuild(data) {
    return new Promise((resolve) => {
        for (let d = 0, dlen = discords.length; d < dlen; d++) {
            if (discords[d].name !== 'test') {
                if (data.plan_id) {
                    if (discords[d].plan_id === data.plan_id) {
                        return resolve(discords[d]);
                    }
                } else if (data.guild_id) {
                    if (discords[d].id === data.guild_id) {
                        return resolve(discords[d]);
                    }
                } else {
                    console.error(`Bad data sent to identifyGuild function from ${data.source}.`, data);
                    return resolve(false);
                }
            }
        }
    });
}


function stripeAudit(last) {
    return new Promise((resolve) => {
        stripe.customers.list({
            limit: 100,
            starting_after: last
        },
        async function (err, list) {
            if (err) {
                console.log(err.message);
                return resolve();
            } else {
                const more = list.has_more;
                console.log(`[MapJS] [${getTime()}] [services/stripe.js] Processing a Batch of ${list.data.length} Customers... More: ${list.has_more}`);
                await customersAudit(list.data);
                if (more) {
                    await stripeAudit(list.data[list.data.length - 1].id);
                    return resolve();
                } else {
                    setTimeout(() => {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Stripe Customer Audit Complete.`);
                        return resolve();
                    }, 1000 * (list.data.length + 1));
                }
            }
        });
    });
}


function customersAudit(customers) {
    return new Promise((resolve) => {
        const length = customers.length;
        for (let c = 0, clen = length; c < clen; c++) {
            const stripeCustomer = customers[c];
            setTimeout(async () => {
                const name = stripeCustomer.name ? stripeCustomer.name : stripeCustomer.description;
                if (stripeCustomer.subscriptions.data[0]) {
                    const guild = await identifyGuild({
                        plan_id: stripeCustomer.subscriptions.data[0].plan.id,
                        source: 'customersAudit'
                    });
                    if(guild){
                        const customer = new StripeClient({
                            user_id: (name.split(' - ')[1]),
                            user_name: (name.split(' - ')[0]),
                            customer_id: stripeCustomer.id,
                            subscription_id: stripeCustomer.subscriptions.data[0].id,
                            guild_id: guild.id,
                            guild_name: guild.name,
                            plan_id: guild.plan_id
                        });
                        if (name && name.split(' - ').length > 1) {
                            if (!stripeCustomer.name) {
                                customer.updateCustomerName();
                            }
                            const record = await customer.fetchRecordByUser();
                            if (record) {
                                if(!record.customer_id || !record.subscription_id){
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Updating database record for ${stripeCustomer.id}.`);
                                    record.customer_id = customer.customerId;
                                    record.subscription_id = customer.subscriptionId;
                                    customer.updateDbRecord();
                                }
                                // if (stripeCustomer.name !== (record.user_name + ' - ' + record.user_id)) {
                                //     console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) name doesnt match customer name '${stripeCustomer.name}'.`);
                                //     console.log(stripeCustomer.name, record.user_name + ' - ' + record.user_id);
                                //     customer.setClientInfo(record);
                                //     customer.updateCustomerName();
                                // }
                                const valid = await customer.validateCustomer();
                                if (record.user_id === customer.userId) {
                                    const user = new DiscordClient(record);
                                    user.donorRole = guild.role;
                                    if(valid){
                                        user.assigned = await user.assignDonorRole();
                                        if (user.assigned) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) found without a Donor Role.`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                        }
                                    } else {
                                        user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer ${customer.userName} (${customer.userId}) found with a Donor Role.`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer found with a Donor Role 🔎', '');
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    }
                                } else {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Customer user_id (${stripeCustomer.name}) does not match the db user_id ${(record.user_name + ' - ' + record.user_id)}.`);
                                    customer.clearDbRecord();
                                }
                            } else {
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] No database record found for ${stripeCustomer.id}.`);
                                customer.insertDbRecord();
                            }
                        }
                    } else {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] No matching guild found for this subscription.`, stripeCustomer.subscriptions.data[0]);
                    }
                } else {
                    const unpaying_customer = new StripeClient({
                        customer_id: stripeCustomer.id
                    });
                    unpaying_customer.deleteCustomer();
                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Active Subscription found for ${stripeCustomer.id}.`);
                }
                if ((c + 1) == length) {
                    return resolve();
                }
            }, 1000 * c);
        }
        setTimeout(() => {
            return resolve();
        }, 1000 * (length + 1));
    });
}


function databaseAudit() {
    return new Promise(async (resolve) => {
        console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Database Audit... (2 of 3)`);
        const records = await db.query(`SELECT * FROM ${config.stripe.db.customer_table} WHERE customer_id is NOT NULL AND customer_id != 'Lifetime';`);
        for (let r = 0, rlen = records.length; r < rlen; r++) {
            const record = records[r];
            setTimeout(async () => {
                const discord = await identifyGuild({
                    guild_id: record.guild_id
                });
                const user = new DiscordClient(record);
                user.donorRole = discord.role;
                record.map_url = discord.domain;
                const member = await user.checkIfMember(record.guild_id);
                if (member) {
                    const customer = new StripeClient(record);
                    const valid = await customer.validateCustomer();
                    if (valid) {
                        if (!record.guild_name || record.guild_name == 'null') {
                            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                            db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${discord.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${discord.id}'`);
                        }
                        if (!record.subscription_id || record.subscription_id == 'null') {
                            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating subscription_id for ${customer.userName} (${record.user_id}).`);
                            db.query(`UPDATE ${config.stripe.db.customer_table} SET subscription_id = '${customer.subscriptionId}' WHERE user_id = '${record.user_id}' AND guild_id = '${discord.id}'`);
                        }
                        if (!record.guild_name || record.guild_name !== discord.name) {
                            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                            db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${discord.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${discord.id}'`);
                        }
                        if (!record.plan_id || record.plan_id == 'null') {
                            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating plan_id for ${customer.userName} (${record.user_id}).`);
                            db.query(`UPDATE ${config.stripe.db.customer_table} SET plan_id = '${discord.plan_id}' WHERE user_id = '${record.user_id}' AND guild_id = '${discord.id}'`);
                        }
                        user.assigned = await user.assignDonorRole();
                        if (user.assigned) {
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role.`);
                            user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                            user.sendChannelEmbed(discord.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                        }
                    } else {
                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found invalid customer ${customer.userName} (${customer.customerId}).`);
                        customer.clearDbRecord();
                        user.removed = await user.removeDonorRole();
                        if (user.removed) {
                            user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                        }
                        if(!record.last_login){
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.customerId}) Has Never Logged In. Deleting Database Record...`);
                            customer.deleteDbRecord();
                        }
                    }
                } else {
                    if (!record.customer_id) {
                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] ${user.userName} (${user.userId}) no longer appears to be a member of ${record.guild_name} (${record.guild_id}).`);
                        //db.query(`DELETE FROM ${config.stripe.db.customer_table} WHERE user_id = '${record.user_id}' AND guild_id = '${record.guild_id}'`);
                    }
                }
                if ((r + 1) === records.length) {
                    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Database Audit Complete.`);
                    return resolve();
                }
            }, 1000 * (r + 1));
        }
    });
}


function guildsAudit(guild_id) {
    return new Promise(async (resolve) => {
        if(!guild_id){
            console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Guild Audit. (3 of 3)`);
        }
        
        for (let d = 0, dlen = discords.length; d < dlen; d++) {
            const discord = discords[d];
            discord.multiplier = discords.length;
            if (discord.role && discord.name != 'test') {
                const guild = new DiscordClient({
                    guild_id: discord.id,
                    guild_name: discord.name,
                    donor_role: discord.role
                });
                const members = await guild.fetchGuildDonors();
                await membersAudit(discord, members);
            }
            if ((d + 1) === discords.length) {
                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Guild Audit Complete.`);
                return resolve();
            }
        }
    });
}


function membersAudit(discord, members) {
    return new Promise((resolve) => {
        for (let m = 0, mlen = members.length; m < mlen; m++) {
            setTimeout(async () => {
                const customer = new StripeClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: discord.id,
                    guild_name: discord.name,
                    plan_id: discord.plan_id,
                    donor_role: discord.role
                });
                const user = new DiscordClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: discord.id,
                    guild_name: discord.name,
                    plan_id: discord.plan_id,
                    donor_role: discord.role
                });
                const record = await customer.fetchRecordByUser();
                if (record) {
                    if(record.plan_id != 'Lifetime'){
                        record.donor_role = discord.role;
                        customer.setClientInfo(record);
                        user.setClientInfo(record);
                        const userRoles = await user.getUserRoles();
                        if (config.ignored_roles && !config.ignored_roles.some(r => userRoles.includes(r))) {
                            if (record.customer_id) {
                                if (record.plan_id === discord.plan_id || record.plan_id === discord.alt_plan_id) {
                                    const valid = await customer.validateCustomer();
                                    if (valid) {
                                        user.assigned = await user.assignDonorRole();
                                        if (user.assigned) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${user.userName} (${user.userId}) found without a Donor Role.`);
                                            user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                            user.sendChannelEmbed(discord.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                        }
                                    } else {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found invalid customer: ${record.user_name} ${record.customer_id}`);
                                        user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    }
                                } else {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] User's plan (${record.plan_id}) does not match any discord plans. Clearing customer data for ${record.user_name} in the db record.`);
                                    customer.clearDbRecord();
                                    user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            } else {
                                console.error(`[MapJS] [${getTime()}] [services/stripe.js] User has no Customer ID in the database. Removing Donor Role from ${record.user_name}`);
                                user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Member found without a Customer ID 🔎', '');
                                user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            }
                        }
                    }
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Record not found for ${customer.userName} (${customer.userId}). Inserting a record.`);
                    user.sendChannelEmbed(discord.stripe_log_channel, 'FF0000', 'DB Record Not Found for Customer 🔎', '');
                    customer.insertDbRecord();
                }
                if ((m + 1) === members.length){
                    return resolve();
                }
            }, 1000 * m);
        }
        setTimeout(() => {
            return resolve();
        }, 1000 * (members.length + 1));
    });
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
//         customer_id varchar(50),
//         user_id varchar(40) NOT NULL,
//         user_name varchar(40) NOT NULL,
//         guild_id varchar(40) NOT NULL,
//         guild_name varchar(50) NOT NULL,
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
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('hh:mmA');
    }
}


ontime({
    cycle: ['00:00:00', '03:00:00', '06:00:00', '09:00:00', '12:00:00', '15:00:00', '18:00:00', '21:00:00']
},
async function (ot) {
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Audits...`);
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Stripe Audit... (1 of 3)`);
    await stripeAudit();
    await databaseAudit();
    await guildsAudit();
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Audits Complete.`);
    return ot.done();
});
// setTimeout(() => {
//     guildsAudit();
// }, 5000);


module.exports = StripeClient;