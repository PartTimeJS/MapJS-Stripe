/* eslint-disable no-async-promise-executor */
'user strict';

const moment = require('moment');
const ontime = require('ontime');
const config = require('../configs/stripe.json');
const discords = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.db);

const DiscordClient = require('./discord.js');
const stripe = require('stripe')(config.stripe.live_sk);

class StripeClient {


    constructor(user) {
        this.userId = user.user_id;
        this.username = user.username;
        this.guildId = user.guildId;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.email = user.email;
        this.mapUrl = user.map_url;
        this.planId = user.plan_id;
        this.customerId = user.customer_id;
        this.subscriptionId = user.subscription_id;
    }


    setUserData(user){
        this.userId = user.user_id;
        this.username = user.username;
        this.guildId = user.guildId;
        this.guildName = user.guild_name;
        this.donorRole = user.donor_role;
        this.email = user.email;
        this.mapUrl = user.map_url;
        this.planId = user.plan_id;
        this.customerId = user.customer_id;
        this.subscriptionId = user.subscription_id;
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
                success_url: this.mapUrl + `/updatesuccess?session_id={CHECKOUT_SESSION_ID}&plan_id=${this.planId}&user_id=${this.userId}&user_name=${this.username}`,
                cancel_url: this.mapUrl + `/cancel?user_name=${this.username}`,
            },
            function(error, session) {
                if (error) {
                    return resolve({
                        status: 'error',
                        error: error
                    });
                }
                this.sessionId = session.id;
                return resolve(session);
            }
            );
        });
    }


    async retrieveSetupIntent(setup_intent) {
        return new Promise(async function(resolve) {
            let intent = await stripe.setupIntents.retrieve(setup_intent);
            return resolve(intent);
        });
    }


    updateCustomerName() {
        stripe.customers.update(
            this.customerId, {
                description: (this.username + ' - ' + this.userId) 
            },
            function(err, customer) {
                if (err) {
                    console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Updating Customer Name.', err.message);
                    return false;
                } else {
                    console.log('[MapJS] [' + getTime() + '] [services/stripe.js] Stripe Customer ' + this.customerId + '\'s Name has been Updated.');
                    return customer;
                }
            }
        );
    }


    updateCustomerDescription() {
        stripe.customers.update(
            this.customerId, {
                description: (this.username + ' - ' + this.userId) 
            },
            function(err, customer) {
                if (err) {
                    console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Updating Customer Description.', err.message);
                    return false;
                } else {
                    console.log('[MapJS] [' + getTime() + '] [services/stripe.js] Stripe Customer ' + this.username + '\'s (' + this.customerId + ') Description has been Updated.');
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
                description: (this.username + ' - ' + this.userId),
                email: this.email,
                source: this.accessToken
            }, function(err, customer) {
                if (err) {
                    console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Creating Customer.', err.message);
                    return resolve(false);
                } else {
                    this.customerId = customer.id;
                    console.log('[MapJS] [' + getTime() + '] [services/stripe.js] Stripe Customer ' + customer.id + ' has been Created.');
                    db.query('UPDATE ${config.db.customer_table} SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, this.user_id]);
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
                function(err, customer) {
                    if (err) {
                        console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Updating Customer.', err.message);
                        return resolve(false);
                    } else {
                        console.log('[MapJS] [' + getTime() + '] [services/stripe.js] Stripe Customer ' + customer.id + ' has been Updated.');
                        db.query('UPDATE ${config.db.customer_table} SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id]);
                        return resolve(customer);
                    }
                }
            );
        });
    }

    fetchCustomer(customer_id) {
        return new Promise((resolve) => {
            stripe.customers.retrieve(
                customer_id,
                function(err, customer) {
                    if (err) {
                        console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Fetching Customer.', err.message);
                        return resolve(false);
                    } else {
                        return resolve(customer);
                    }
                });
        });
    }


    insertDbRecord() { 
        db.query(`
            INSERT IGNORE INTO ${config.db.customer_table} (
                    user_id,
                    user_name,
                    email,
                    plan_id,
                    guild_id,
                    guild_name
                ) 
            VALUES 
                (
                    '${this.userId}', 
                    '${this.userName}', 
                    '${this.email}',
                    '${this.planId}',
                    '${this.guildId}',
                    '${this.guildName}'
                );
        `);
    }


    updateDbRecord() { 
        db.query(`
            UPDATE
                ${config.db.customer_table}
            SET
                plan_id = '${this.planId}',
                subscription_id = '${this.subscriptionId}',
                customer_id = '${this.customerId}',
            WHERE
                user_id = '${this.userId}';
        `);
    }


    fetchRecordByUser(){
        return new Promise(async (resolve) => {
            const data = await db.query(`
                SELECT 
                    * 
                FROM 
                    ${config.db.customer_table}
                WHERE 
                    user_id = '${this.userId}'
                        AND
                    guild_id = '${this.guildId}';
            `);
            if(data){
                if(data.length > 1){
                    console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Saw multiple users returned from the user query', data);
                }
                return resolve(data[0]);
            } else {
                return resolve(false);
            }
        });
    }


    fetchRecordByCustomer(){
        return new Promise(async (resolve) => {
            const data = await db.query(`
                SELECT 
                    * 
                FROM 
                    ${config.db.customer_table} 
                WHERE 
                    customer_id = '${this.customerId}';
            `);
            if(data){
                if(data.length > 1){
                    console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Saw multiple users returned from the user query', data);
                }
                return resolve(data[0]);
            } else {
                return resolve(false);
            }
        });
    }


    clearDbRecord(){
        db.query(`
            UPDATE
                ${config.db.customer_table}
            SET
                customer_id = NULL,
                plan_id = NULL,
                subsciption_id = NULL
            WHERE
                customer_id = '${this.customerId}';`
        ); return;
    }


    deleteCustomer() {
        return new Promise((resolve) => {
            stripe.customers.del(
                this.customerId,
                function(err, confirmation) {
                    if (err) {
                        console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Deleting Customer.', err.message);
                        return resolve(false);
                    } else {
                        console.log('[MapJS] [' + getTime() + '] [services/stripe.js] Stripe Customer ' + this.customerId + ' has been Deleted.');
                        return resolve(confirmation);
                    }
                });
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
    //                 console.error('[MapJS] [' + getTime() + '] [services/stripe.js] Error Creating Subscription.', err.message);
    //                 return resolve(object);
    //             } else {
    //                 db.query('UPDATE ${config.db.customer_table} SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [this.customerId, this.planId, this.userId, this.guildId]);
    //                 console.log('[MapJS] [' + getTime() + '] [services/stripe.js] A New Stripe Subscription has been Created.');
    //                 return resolve(subscription);
    //             }
    //         });
    //     });
    // }


    async cancelSubscription() {
        return new Promise((resolve) => {
            stripe.subscriptions.update(
                this.subscriptionId, {
                    cancel_at_period_end: true
                },
                function(err, confirmation) {
                    if (err) {
                        return resolve(false);
                    } else {
                        return resolve(confirmation);
                    }
                }
            );
        });
    }
}


async function identifyGuild(data){
    return new Promise((resolve) => {
        for(let d = 0, dlen = discords.length; d < dlen; d++){
            if(data.plan_id){
                if(discords[d].plan_id === data.plan_id){
                    return resolve(discords[d]);
                }
            } else if (data.guild_id){
                if(discords[d].id === data.guild_id){
                    return resolve(discords[d]);
                }
            } else {
                console.error('Bad data sent to identifyGuild function from ' + data.source + '.' + data);
                return resolve(false);
            }
        }
    });
}


function getTime (type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        case 'unix':
            return moment().unix();
        case 'ms':
            return moment().valueOf();
        default:
            return moment().format('h:mmA');
    }
}


ontime(
    { cycle: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'] }, 
    async function(ot) {
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Starting Audits...');
        await auditDatabase();
        await auditGuilds();
        await auditCustomers();
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Audit Complete.');
        return ot.done();
    }
);


async function auditDatabase(){
    return new Promise(async (resolve) => {
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Starting Database Audit.');
        let records = await db.query(`
            SELECT
                *
            FROM
                ${config.db.customer_table}
            WHERE
                customer_id is NOT NULL;
        `);
        for(let r = 0, rlen = records.length; r < rlen; r++){
            let record = records[r];
            setTimeout(async () => {
                const user = new DiscordClient(record);
                const member = await user.checkIfMember(record.guild_id);
                if(member){
                    let customer = new StripeClient(record);
                    const hasRole = '';
                } else {
                    console.error('[MapJS] [' + getTime() + '[services/stripe.js] Member ' + record.user_name + ' (' + record.user_id + ') no longer appears to be a member of  ' + record.guild_name + ' (' + record.guild_id + ').');
                }
            }, 1000 * 5);
        }
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Guild Audit Complete.');
        return resolve();
    });
}

async function auditGuilds(){
    return new Promise(async (resolve) => {
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Starting Guild Audit.');
        for(let d = 0, dlen = discords.length; d < dlen; d++){
            
            const discord = discords[d];
            if(discord.role){
                const guild = new DiscordClient({
                    guild_id: discord.id, 
                    guild_name: discord.name,
                    donor_role: discord.role
                });
                const members = await guild.fetchGuildDonors();
                await auditMembers(members);
            } 
        }
        console.info('[MapJS] [' + getTime() + '[services/stripe.js] Guild Audit Complete.');   
    });
}

async function auditMembers(members){
    return new Promise((resolve) => {
        for(let m = 0, mlen = members.length; m < mlen; m++){
            if(config.ignored_users.includes(members[m].id)){
                continue;
            }
            setTimeout(async () => {
                const client = new StripeClient({
                    user_id: member.id,
                    guild_id: discord.id, 
                    guild_name: discord.name,
                    donor_role: discord.role
                });
                const record = await client.fetchRecordByUser();
                if(record){
                    const member = new DiscordClient(record);
                    const userRoles = member.getUserRoles();
                    if(!config.ignored_roles.some(r=> userRoles.includes(r))){
                        if(record.customer_id){
                            member.assignDonorRole();
                        } else {
                            member.removeDonorRole();
                        }
                    }
                }
            }, 2000 * m);
        }
    });
}

setTimeout(() => {
    auditGuilds();
}, 5000);


async function auditCustomers(last){
    stripe.customers.list({
            limit: 100,
            starting_after: last
        },
        async function(err, list) {
            if (err) {
                console.log(err.message);
                return false;
            } else {
                await this.checkCustomers(list.data);
                if (list.has_more != false) {
                    await auditCustomers(list.data[list.data.length - 1].id);
                }
                return true;
            }
        }
    );
}


async function checkCustomers(customers) {
        customers.forEach((stripeCustomer, index) => {
            setTimeout(() => {
                const guild = identifyGuild({
                    plan_id: stripeCustomer.subscriptions.data[0].plan.id,
                    source: 'checkCustomers'
                });
                if(customer.name.split(' - ')[0]){
                    const user = new StripeClient({
                        userId: customer.name.split(' - ')[0],
                        userName: customer.name.split(' - ')[1],
                        customerId: customer.id,
                        guildId: guild.id,
                        guildName: guild.name,
                        planId: guild.plan_id
                    });
                    if(stripeCustomer.subscriptions.data[0]){
                        const record = user.fetchRecordByCustomer();
                        const member = new DiscordClient(record);
                        if(record){
                            user.setUserData(record);
                            
                        } else {
                            console.log('No database record found for ' + stripeCustomer.id + '. Inserting a record.');
                            user.insertDbRecord();
                        }
                    } else {
                        // DELETE CUSTOMER
                        console.error(user.customerId + ' needs to be deleted.');
                    }
                } else {
                    console.error(user.customerId + ' has no customer name.');
                }
                
            }, 5000 * index);
        });
    }
}
    


 
 





// records.forEach((user, index) => {
//     setTimeout(async function() {
//         let member = bot.guilds.cache.get(user.map_guild).members.cache.get(user.user_id);
//         let customer = '';
//         if (member) {
//             if (member.roles.cache.has(config.donor_role)) {
//                 if (!user.stripe_id) {
//                     bot.removeDonor(member.id);
//                     return bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role.', config.stripe_log_channel);
//                 } else {
//                     customer = await stripe.customer.fetch(user.stripe_id);
//                     user = await bot.users.fetch(user.user_id);
//                     if (customer.name != (user.username + ' - ' + user.id)) {
//                         stripe.updateCustomerName(customer.id, user.username + ' - ' + user.id);
//                     }
//                     if (customer.description != (user.username + ' - ' + user.id)) {
//                         stripe.updateCustomerDescription(customer.id, user.username + ' - ' + user.id);
//                     }
//                     if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
//                         bot.removeDonor(member.id);
//                         bot.sendEmbed(member, 'FF0000', 'User found without a Subscription ⚠', 'Removed Donor Role.', config.stripe_log_channel);
//                         object.runQuery(
//                             `UPDATE
//                                 ${config.db.customer_table}
//                             SET
//                                 stripe_id = NULL,
//                                 plan_id = NULL,
//                                 sub_id = NULL
//                             WHERE
//                                 user_id = ${member.id}
//                                 AND map_guild = ${config.guild_id};`
//                         );
//                     } else if (customer.subscriptions.data[0].status != 'active') {
//                         bot.removeDonor(member.id);
//                         bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Stripe Check)', config.stripe_log_channel);
//                         object.runQuery(
//                             `UPDATE
//                                 ${config.db.customer_table}
//                             SET
//                                 stripe_id = NULL,
//                                 plan_id = NULL,
//                                 sub_id = NULL
//                             WHERE
//                                 user_id = ${member.id}
//                                 AND map_guild = ${config.guild_id};`
//                         );
//                     }
//                 }
//             } else if (user.stripe_id && user.stripe_id.startsWith('cus')) {
//                 customer = await stripe.customer.fetch(user.stripe_id);
//                 if (!customer || customer.deleted == true) {
//                     await object.runQuery(
//                         `UPDATE
//                         ${config.db.customer_table}
//                         SET
//                         stripe_id = NULL,
//                         plan_id = NULL,
//                         sub_id = NULL
//                         WHERE
//                         user_id = ${member.id}
//                         AND map_guild = ${config.guild_id};`
//                     );
//                     return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Updated ' + user.username + ' Record to Reflect no active Stripe information.', config.stripe_log_channel);
//                 } else if (!customer.subscriptions.data[0]) {
//                     stripe.customer.delete(customer.id);
//                     await object.runQuery(
//                         `UPDATE
//                             ${config.db.customer_table}
//                         SET
//                             stripe_id = NULL,
//                             plan_id = NULL,
//                             sub_id = NULL
//                         WHERE
//                             user_id = ${member.id}
//                             AND map_guild = ${config.guild_id};`
//                     );
//                     return bot.sendEmbed(member, 'FF0000', 'Found Database Discrepency ⚠', 'Deleted Customer record for ' + user.username + ' (' + member.id + ').', config.stripe_log_channel);
//                 } else if (customer.subscriptions.data[0].status == 'active') {
//                     bot.assignDonor(member.id);
//                     return bot.sendEmbed(member, 'FF0000', 'User found without Donor Role ⚠', 'Assigned Donor Role.', config.stripe_log_channel);
//                 }
//             }
//         }
//     }, 5000 * index);
// });
// let guild = bot.guilds.cache.get(config.guild_id);
// let members = guild.roles.cache.find(role => role.id === config.donor_role).members.map(m => m);
// members.forEach((member, index) => {
//   setTimeout(function() {
//     let query = `SELECT * FROM ${config.db.customer_table} WHERE user_id = ? AND map_guild = ?`;
//     let data = [member.id, config.guild_id],
//       removed = '';
//     object.db.query(query, data, async function(err, record, fields) {
//       if (err) {
//         return console.error(err);
//       }
//       switch (true) {
//         case !record[0]:
//           return;
//         case record[0].stripe_id == 'Lifetime':
//           return;
//         case record[0].stripe_id != 'Lifetime':
//           if (!record[0].stripe_id && member.roles.cache.has(config.donor_role)) {
//             bot.removeDonor(member.id);
//             return bot.sendEmbed(member, 'FF0000', 'User found without a Stripe ID ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
//           } else {
//             customer = await stripe.customer.fetch(record[0].stripe_id);
//             if (!customer || customer.deleted == true || !customer.subscriptions || !customer.subscriptions.data[0]) {
//               if (member.roles.cache.has(config.donor_role)) {
//                 bot.removeDonor(member.id);
//               }
//               bot.sendEmbed(member, 'FF0000', 'No Customer found for this User ⚠', 'Removed Donor Role.', config.stripe_log_channel);
//               query = `UPDATE ${config.db.customer_table} SET stripe_id = NULL, plan_id = NULL WHERE user_id = ? AND map_guild = ?`;
//               data = [member.id, config.guild_id];
//               return object.runQuery(query, data);
//             } else if (customer.subscriptions.data[0].status != 'active' && member.roles.cache.has(config.donor_role)) {
//               bot.removeDonor(member.id);
//               return bot.sendEmbed(member, 'FF0000', 'User found without an Active Subscription ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
//             }
//           }
//           return;
//         case member.roles.cache.has(config.donor_role):
//           bot.removeDonor(member.id);
//           return bot.sendEmbed(member, 'FF0000', 'User found without a DB Record ⚠', 'Removed Donor Role. (Member Check)', config.stripe_log_channel);
//       }
//     });
//   }, 5000 * index);
// });
// return;

let cust_table = `
    CREATE TABLE IF NOT EXISTS ${config.db.cust_table}(
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
db.query(cust_table).catch(err => {
    console.error('Failed to execute query:', cust_table, '\r\n:Error:', err);
});

let log_table = `
    CREATE TABLE IF NOT EXISTS ${config.db.log_table}(
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
db.query(log_table).catch(err => {
    console.error('Failed to execute query:', log_table, '\r\n:Error:', err);
});
// async function migrate(){
//     let records = await db.query(`SELECT * FROM ${config.db.customer_table};`).catch(err => {
//         console.error('Failed to execute query:', user_table, '\r\n:Error:', err);
//     });
    
//     records.forEach((record) => {
//         db.query(`
//             INSERT INTO 
//                 ${config.db.cust_table} (
//                     user_id,
//                     user_name,
//                     guild_id,
//                     guild_name,
//                     plan_id,
//                     customer_id,
//                     subscription_id,
//                     email,
//                     access_token,
//                     refresh_token
//                 )
//             VALUES
//                 (
//                     '${record.user_id}',
//                     '${record.user_name}',
//                     '${record.map_guild}',
//                     '${record.map_name}',
//                     '${record.plan_id}',
//                     '${record.stripe_id}',
//                     '${record.sub_id}',
//                     '${record.email}',
//                     '${record.access_token}',
//                     '${record.refresh_token}'
//                 );
//         `);
//     });
// }
// setTimeout(() => {
//     migrate();
// }, 5000);



module.exports = StripeClient;
