const moment = require('moment');
const fs = require('fs');

const config = require('../configs/stripe.json');
//const config = require('../config.json');

const MySQLConnector = require('./mysql.js');
const db = new MySQLConnector(config.db);

const stripe = require('stripe')(config.stripe.live_sk);

class StripeClient {
    constructor(user) {
        this.user_id = user.user_id;
        this.user_name = user.user_name;
        this.email = user.email;
        this.map_url = user.map_url;
        this.plan_id = user.plan_id;
        this.customer_id = user.customer_id;
        this.subscription_id = user.subscription_id;
    }


    setSubscriptionID(subscription_id) {
        this.subscription_id = subscription_id;
    }
    get subscriptionID() {
        return this.subscription_id;
    }


    setCustomerID(customer_id) {
        this.customer_id = customer_id;
    }
    get customerID() {
        return this.customer_id;
    }


    createSession(user) {
        return new Promise(async function(resolve) {
            stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                mode: 'setup',
                customer: this.customer_id,
                setup_intent_data: {
                    metadata: {
                        plan_id: this.plan_id,
                        subscription_id: this.subscription_id
                    },
                },
                success_url: config.map_url + `/updatesuccess?session_id={CHECKOUT_SESSION_ID}&plan_id=${config.STRIPE.plan_id}&user_id=${user.user_id}&user_name=${user.user_name}`,
                cancel_url: config.map_url + `/cancel?user_name=${user.user_name}`,
                },
                function(error, session) {
                if (error) {
                    return resolve({
                    status: "error",
                    error: error
                    })
                }
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


    updateCustomerName(cust_id, new_name) {
        stripe.customers.update(
            cust_id, {
                name: new_name
            },
            function(err, customer) {
                if (err) {
                console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Updating Customer Name.', err.message);
                return;
                } else {
                console.log('[' + bot.getTime('stamp') + '] [stripe.js] Stripe Customer ' + customer.id + '\'s Name has been Updated.');
                return customer;
                }
            }
        );
    }


    updateCustomerDescription(cust_id, new_desc) {
        stripe.customers.update(
            cust_id, {
                description: new_desc
            },
            function(err, customer) {
                if (err) {
                console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Updating Customer Description.', err.message);
                return;
                } else {
                console.log('[' + bot.getTime('stamp') + '] [stripe.js] Stripe Customer ' + customer.id + '\'s Description has been Updated.');
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


    createCustomer(user_name, user_id, user_email, token) {
        return new Promise(function(resolve) {
            stripe.customers.create({
                description: user_name + ' - ' + user_id,
                email: user_email,
                source: token
            }, function(err, customer) {
                if (err) {
                console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Creating Customer.', err.message);
                return resolve(null);
                } else {
                console.log('[' + bot.getTime('stamp') + '] [stripe.js] Stripe Customer ' + customer.id + ' has been Created.');
                db.query('UPDATE oauth_users SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id])
                return resolve(customer);
                }
            });
        });
    }


    updateCustomerPayment(user_id, customer, token) {
        return new Promise(function(resolve) {
            stripe.customers.update(
                customer.id, {
                source: token
                },
                function(err, customer) {
                if (err) {
                    console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Updating Customer.', err.message);
                    return resolve('ERROR');
                } else {
                    console.log('[' + bot.getTime('stamp') + '] [stripe.js] Stripe Customer ' + customer.id + ' has been Updated.');
                    db.query('UPDATE oauth_users SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id]);
                    return resolve(customer);
                }
                }
            );
        });
    }

    fetchCustomer(customer_id) {
        return new Promise(function(resolve) {
            stripe.customers.retrieve(
                customer_id,
                function(err, customer) {
                if (err) {
                    console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Fetching Customer.', err.message);
                    return resolve('ERROR');
                } else {
                    return resolve(customer);
                }
            });
        });
    }

    deleteCustomer(customer_id) {
        return new Promise(function(resolve) {
            stripe.customers.del(
                customer_id,
                function(err, confirmation) {
                if (err) {
                    console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Deleting Customer.', err.message);
                    return resolve('ERROR');
                } else {
                    console.log('[' + bot.getTime('stamp') + '] [stripe.js] Stripe Customer ' + customer_id + ' has been Deleted.');
                    return resolve(confirmation);
                }
            });
        });
    }


    async listCustomers(last) {
        stripe.customers.list({
                limit: 100,
                starting_after: last
            },
            async function(err, list) {
                if (err) {
                console.log(err.message);
                } else {
                    await object.customer.parse(list.data);
                    if (list.has_more != false) {
                        object.customer.list(list.data[list.data.length - 1].id);
                    }
                }
            }
        );
    }


    parseCustomers(parse) {
        parse.forEach((customer, index) => {
            setTimeout(function() {
                if (customer.subscriptions.data[0] && (customer.subscriptions.data[0].plan.id == config.STRIPE.plan_id || customer.subscriptions.data[0].plan.id == config.STRIPE.secondary_plan_id)) {
                    let unix = moment().unix();
                    database.db.query('SELECT * FROM oauth_users WHERE user_id = ? AND map_guild = ?', [customer.name.split(' - ')[1], config.guild_id], async function(err, record, fields) {
                        if (err) {
                            return console.error('[' + bot.getTime('stamp') + '] [stripe.js]', err.message);
                        }
                        if (record[0]) {
                            if (record[0].stripe_id == 'Lifetime' || record[0].plan_id == "GoFest") {
                                return;
                            } else {
                                db.query('UPDATE oauth_users SET user_name = ?, stripe_id = ?, plan_id = ?, email = ?, last_updated = ? WHERE user_id = ? AND map_guild = ?',
                                [customer.name.split(' - ')[0], customer.id, customer.subscriptions.data[0].plan.id, customer.email, unix, customer.name.split(' - ')[1], config.guild_id]);
                            }
                        } else {
                            db.query('INSERT INTO oauth_users (user_name, user_id, map_name, map_guild, stripe_id, plan_id, email, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                [customer.name.split(' - ')[0], customer.name.split(' - ')[1], config.map_name, config.guild_id, customer.id, customer.subscriptions.data[0].plan.id, customer.email, unix]);
                            return console.info('[' + bot.getTime('stamp') + '] [stripe.js] ' + customer.name.split(' - ')[0] + ' (' + customer.name.split(' - ')[1] + ' | ' + customer.id + ') Inserted User into the User Database.');
                        }
                    });
                }
            }, 5000 * index);
        });
    }


    async createSubscription(customer, user_id) {
        return new Promise(function(resolve) {
        stripe.subscriptions.create({
            customer: customer.id,
            items: [{
            plan: config.STRIPE.plan_id,
            }, ]
        }, function(err, subscription) {
            if (err) {
            let object = {
                title: "ERROR",
                message: err.message,
            }
            console.error('[' + bot.getTime('stamp') + '] [stripe.js] Error Creating Subscription.', err.message);
            return resolve(object);
            } else {
            db.query('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [subscription.customer, subscription.plan.id, user_id, config.guild_id]);
            console.log('[' + bot.getTime('stamp') + '] [stripe.js] A New Stripe Subscription has been Created.');
            return resolve(subscription);
            }
        });
        });
    }


    async cancelSubscription(subscription_id) {
        return new Promise(function(resolve) {
        stripe.subscriptions.update(
            subscription_id, {
            cancel_at_period_end: true
            },
            function(err, confirmation) {
            if (err) {
                return resolve(null);
            } else {
                return resolve(confirmation);
            }
            }
            );
        });
    }
}

let user_table = `
  CREATE TABLE IF NOT EXISTS stripe_users(
      user_id varchar(40) NOT NULL,
      user_name varchar(40) NOT NULL,
      cust_id varchar(50),
      plan_id varchar(50),
      sub_id varchar(50),
      email varchar(40),
      access_token varchar(60),
      refresh_token varchar(60),
      last_login varchar(20),
      quest_delivery bigint,
      embed LONGTEXT NOT NULL,
      PRIMARY KEY (user_id) USING BTREE
  )
`;

db.query(user_table).catch(err => {
  console.error('Failed to execute query:', user_table, '\r\n:Error:', err);
});


module.exports = StripeClient;
