/* eslint-disable no-async-promise-executor */
const moment = require('moment');
const ontime = require('ontime');
const config = require('../configs/stripe.json');
const guilds = require('../configs/discords.json').discords;

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.stripe.db);

const DiscordClient = require('./discord.js');
const StripeClient = require('./stripe.js');

const stripe = require('stripe')(config.stripe.live_sk);
//const stripe = require('stripe')('sk_test_51BFqArHIrnCEspBZIahCA8TcdZKHOGD3YUd1qWbMGcoyLkvPo09sf2kNT9irUWlnGO6QiHgqSmqJ7d5OOTAsa2A400OldQIPgt');

function identifyGuild(data) {
    return new Promise((resolve) => {
        if(!data){
            data = this;
        }
        let plan_id = data.plan_id ? data.plan_id : data.planId;
        let guild_id = data.guild_id ? data.guild_id : data.guildId;
        let guild;
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            if (guilds[d].name !== 'test') {
                if (plan_id) {
                    if (guilds[d].recurring_id === plan_id) {
                        guild = guilds[d]; break;
                    }
                    if (guilds[d].onetime_id === plan_id) {
                        guild = guilds[d]; break;
                    }
                    if (guilds[d].alt_plan_id === plan_id) {
                        guild = guilds[d]; break;
                    }
                } else if (guild_id) {
                    if (guilds[d].id === guild_id) {
                        guild = guilds[d]; break;
                    }
                } else {
                    console.error(`Bad data received from ${data.source}.`, data);
                    return resolve(false);
                }
            }
        }
        if(guild){
            return resolve(guild);
        } else {
            return resolve(false);
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
                if(!name){
                    console.error('No Name for Customer', stripeCustomer);
                }
                const customer = new StripeClient({
                    user_id: (name.split(' - ')[1]),
                    user_name: (name.split(' - ')[0]),
                    customer_id: stripeCustomer.id,
                    subscription_id: (stripeCustomer.subscriptions.data[0] ? stripeCustomer.subscriptions.data[0].plan_id : null)
                });
                const record = await customer.fetchRecordByCustomer();
                if (record) {
                    customer.setClientInfo(record);
                    const user = new DiscordClient(record);
                    const guild = await customer.identifyGuild(record);
                    user.setGuildInfo(guild);
                    customer.setGuildInfo(guild);
                    if (stripeCustomer.name != (record.user_name + ' - ' + record.user_id)) {
                        customer.updateCustomerName();
                    }
                    if (stripeCustomer.subscriptions.data[0]) {
                        if(!record.customer_id || !record.subscription_id){
                            customer.updateDbRecord();
                        }
                        if (record.user_id === customer.userId) {
                            const validCustomer = await customer.validateCustomer();
                            if(validCustomer){
                                const validSubscription = await customer.validateSubscription();
                                if(validSubscription){
                                    user.assigned = await user.assignDonorRole();
                                    if (user.assigned) {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                    }
                                } else {
                                    //user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`);
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            } else {
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer Found 🔎', '');
                                customer.clearDbRecord();
                                //customer.deleted = customer.deleteCustomer();
                                if(customer.deleted){
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer Deleted', '');
                                }
                                //user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer ${customer.userName} (${customer.userId}) found with a Donor Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            }
                        } else {
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] Customer user_id (${stripeCustomer.name}) does not match the db user_id ${(record.user_name + ' - ' + record.user_id)}.`);
                            customer.clearDbRecord();
                        }
                    } else {
                        if(Number.isInteger(parseInt(record.subscription_id))){
                            const expiration = parseInt(record.subscription_id);
                            if(expiration < moment().unix()){

                                // user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    user.sendDmEmbed('');
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer ${customer.userName} (${customer.userId}) found with a Donor Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'One Month Access Expired ⌛', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            } else {
                                user.assigned = await user.assignDonorRole();
                                if (user.assigned) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                }
                            }
                        } else {
                            const validSubscription = await customer.validateSubscription();
                            if(validSubscription){
                                user.assigned = await user.assignDonorRole();
                                if (user.assigned) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                    user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                }
                            } else {
                                //user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Subscription Found 🔎', '');
                                //user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`);
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                                //customer.deleteCustomer();
                                console.error(`[MapJS] [${getTime()}] [services/stripe.js] No Active Subscription found for ${stripeCustomer.id}.`);
                            }
                        }   
                    }
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] No database record found for ${stripeCustomer.id}.`);
                    customer.insertDbRecord();
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
        const records = await db.query(`SELECT * FROM ${config.stripe.db.customer_table} WHERE customer_id is NOT NULL;`);
        for (let r = 0, rlen = records.length; r < rlen; r++) {
            const record = records[r];
            setTimeout(async () => {
                const guild = await identifyGuild({
                    guild_id: record.guild_id
                });
                const user = new DiscordClient(record);
                user.donorRole = guild.role;
                record.map_url = guild.domain;
                if(!record.guild_id){
                    console.log('no record', record);
                }
                const member = await user.checkIfMember(record.guild_id);
                if (member) {
                    if(record.customer_id == 'Lifetime'){
                        user.assigned = await user.assignDonorRole();
                        if (user.assigned) {
                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${record.user_name} (${record.user_id}) found without a Donor Role and assigned Role.`);
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Lifetime Member found without a Donor Role 🔎', '');
                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                        }
                    } else {
                        const customer = new StripeClient(record);
                        const validCustomer = await customer.validateCustomer();
                        if(validCustomer){
                            if(customer.planId === guild.onetime_id){
                                if(record.subscription_id < moment().unix()){
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'One Month Access Expired ⌛', '');
                                    //customer.deleted = customer.deleteCustomer();
                                    if(customer.deleted){
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Expired Customer Deleted', '');
                                    }
                                    //user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer ${customer.userName} (${customer.userId}) found with a Donor Role.`);
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            } else {
                                const validSubscription = await customer.validateSubscription();
                                if(validSubscription){
                                    if (!record.guild_name || record.guild_name == 'null') {
                                        console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                                        db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${guild.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                    }
                                    if (!record.subscription_id || record.subscription_id == 'null') {
                                        console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating subscription_id for ${customer.userName} (${record.user_id}).`);
                                        db.query(`UPDATE ${config.stripe.db.customer_table} SET subscription_id = '${customer.subscriptionId}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                    }
                                    if (!record.guild_name || record.guild_name !== guild.name) {
                                        console.info(`[MapJS] [${getTime()}] [services/stripe.js] Found discrepency. Updating guild_name for ${customer.userName} (${record.user_id}).`);
                                        db.query(`UPDATE ${config.stripe.db.customer_table} SET guild_name = '${guild.name}' WHERE user_id = '${record.user_id}' AND guild_id = '${guild.id}'`);
                                    }
                                    user.assigned = await user.assignDonorRole();
                                    if (user.assigned) {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${record.user_id}) found without a Donor Role and assigned Role.`);
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                        user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                    }
                                } else {
                                    console.error(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`, customer);
                                    //user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        console.error(`[MapJS] [${getTime()}] [services/stripe.js] ${customer.userName} (${customer.userId}) has an invalid Subscription.`);
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            }
                        } else {
                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer Found 🔎', '');
                            customer.clearDbRecord();
                            //customer.deleted = customer.deleteCustomer();
                            if(customer.deleted){
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Invalid Customer Deleted', '');
                            }
                            //user.removed = await user.removeDonorRole();
                            if (user.removed) {
                                console.log(`[MapJS] [${getTime()}] [services/stripe.js] Invalid Customer ${customer.userName} (${customer.userId}) found with a Donor Role.`);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                            }
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
        for (let d = 0, dlen = guilds.length; d < dlen; d++) {
            const guildToCheck = guilds[d];
            if (guildToCheck.role && guildToCheck.name != 'test') {
                const guild = new DiscordClient({
                    guild_id: guildToCheck.id,
                    guild_name: guildToCheck.name,
                    donor_role: guildToCheck.role
                });
                const members = await guild.fetchGuildDonors();
                await membersAudit(guildToCheck, members);
            }
            if ((d + 1) === guilds.length) {
                console.info(`[MapJS] [${getTime()}] [services/stripe.js] Guild Audit Complete.`);
                return resolve();
            }
        }
    });
}


function membersAudit(guild, members) {
    return new Promise((resolve) => {
        for (let m = 0, mlen = members.length; m < mlen; m++) {
            setTimeout(async () => {
                const customer = new StripeClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: guild.id,
                    guild_name: guild.name,
                    donor_role: guild.role
                });
                const user = new DiscordClient({
                    user_id: members[m].id,
                    user_name: members[m].user.username,
                    guild_id: guild.id,
                    guild_name: guild.name,
                    donor_role: guild.role
                });
                const record = await customer.fetchRecordByUser();
                if (record) {
                    if(record.plan_id != 'Lifetime'){
                        record.donor_role = guild.role;
                        customer.setClientInfo(record);
                        user.setClientInfo(record);
                        const userRoles = await user.getUserRoles();
                        if (config.ignored_roles && !config.ignored_roles.some(r => userRoles.includes(r))) {
                            if (record.customer_id) {
                                if (record.plan_id === guild.recurring_id || record.plan_id === guild.onetime_id || record.plan_id === guild.alt_plan_id) {
                                    const valid = await customer.validateCustomer();
                                    if (valid) {
                                        user.assigned = await user.assignDonorRole();
                                        if (user.assigned) {
                                            console.log(`[MapJS] [${getTime()}] [services/stripe.js] ${user.userName} (${user.userId}) found without a Donor Role.`);
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Customer found without a Donor Role 🔎', '');
                                            user.sendChannelEmbed(guild.stripe_log_channel, '00FF00', 'Donor Role Assigned ⚖', '');
                                        }
                                    } else {
                                        console.log(`[MapJS] [${getTime()}] [services/stripe.js] Found invalid customer: ${record.user_name} ${record.customer_id}`);
                                        //user.removed = await user.removeDonorRole();
                                        if (user.removed) {
                                            user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                        }
                                    }
                                } else {
                                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] User's plan (${record.plan_id}) does not match any discord plans. Clearing customer data for ${record.user_name} in the db record.`);
                                    customer.clearDbRecord();
                                    //user.removed = await user.removeDonorRole();
                                    if (user.removed) {
                                        user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                    }
                                }
                            } else {
                                console.error(`[MapJS] [${getTime()}] [services/stripe.js] User has no Customer ID in the database. Removing Donor Role from ${record.user_name}`);
                                user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Member found without a Customer ID 🔎', '');
                                //user.removed = await user.removeDonorRole();
                                if (user.removed) {
                                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'Donor Role Removed ⚖', '');
                                }
                            }
                        }
                    }
                } else {
                    console.log(`[MapJS] [${getTime()}] [services/stripe.js] Record not found for ${customer.userName} (${customer.userId}). Inserting a record.`, 'log_channel', guild.stripe_log_channel);
                    user.sendChannelEmbed(guild.stripe_log_channel, 'FF0000', 'DB Record Not Found for Customer 🔎', '');
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

    
ontime({
    cycle: ['00:00:00', '06:00:00', '12:00:00', '18:00:00']
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

setTimeout(async () => {
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Audits...`);
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Starting Stripe Audit... (1 of 3)`);
    await stripeAudit();
    await databaseAudit();
    await guildsAudit();
    console.info(`[MapJS] [${getTime()}] [services/stripe.js] Audits Complete.`);
}, 5000);

function getTime(type) {
    switch (type) {
        case 'full':
            return moment().format('dddd, MMMM Do  h:mmA');
        default:
            return moment().format('hh:mmA');
    }
}