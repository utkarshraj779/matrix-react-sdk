/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/// <reference types="cypress" />

import { SynapseInstance } from "../../plugins/synapsedocker";
import { SettingLevel } from "../../../src/settings/SettingLevel";
import { Layout } from "../../../src/settings/enums/Layout";
import { ProxyInstance } from "../../plugins/sliding-sync";
import _ from "lodash";
import { createClient, MatrixClient } from "matrix-js-sdk";

describe("Sliding Sync", () => {
    beforeEach(() => {
        cy.startSynapse("default").as("synapse").then(synapse => {
            cy.startProxy(synapse).as("proxy");
        });

        cy.all([
            cy.get<SynapseInstance>("@synapse"),
            cy.get<ProxyInstance>("@proxy"),
        ]).then(([synapse, proxy]) => {
            cy.enableLabsFeature("feature_sliding_sync");

            cy.intercept("/config.json?cachebuster=*", req => {
                return req.continue(res => {
                    res.send(200, {
                        ...res.body,
                        sliding_sync_proxy_url: `http://localhost:${proxy.port}`,
                    });
                });
            });

            cy.initTestUser(synapse, "Sloth").then(() => {
                return cy.window({ log: false }).then(() => {
                    cy.createRoom({ name: "Test Room" }).as("roomId");
                });
            });
        });
    });

    afterEach(() => {
        cy.get<SynapseInstance>("@synapse").then(cy.stopSynapse);
        cy.get<ProxyInstance>("@proxy").then(cy.stopProxy);
    });

    // assert order
    const checkOrder = (wantOrder: string[]) => {
        cy.contains(".mx_RoomSublist", "Rooms").find(".mx_RoomTile_title").should((elements) => {
            expect(_.map(elements, (e) => {
                return e.textContent;
            }), "rooms are sorted").to.deep.equal(wantOrder);
        });
    };
    const bumpRoom = (alias: string) => {
        // Send a message into the given room, this should bump the room to the top
        cy.get<string>(alias).then((roomId) => {
            return cy.sendEvent(roomId, null, "m.room.message", {
                body: "Hello world",
                msgtype: "m.text",
            });
        });
    }
    const createAndJoinBob = () => {
        // create a Bob user
        let baseUrl;
        cy.get<SynapseInstance>("@synapse").then((synapse) => {
            baseUrl = synapse.baseUrl;
            return cy.registerUser(synapse, "bob", "passwordgoeshere123", "Bob");
        }).then((creds) => {
            return createClient({
                baseUrl: baseUrl,
                accessToken: creds.accessToken,
                userId: creds.userId,
                deviceId: creds.deviceId,
            });
        }).as("bob");

        // invite Bob to Test Room and accept then send a message.
        cy.all([cy.get<string>("@roomId"), cy.get<MatrixClient>("@bob")]).then(([roomId, bob]) => {
            return cy.inviteUser(roomId, bob.getUserId()).then(() => {
                return bob.joinRoom(roomId);
            });
        });
    }

    // sanity check everything works
    it("should correctly render expected messages", () => {
        cy.get<string>("@roomId").then(roomId => cy.visit("/#/room/" + roomId));
        cy.setSettingValue("layout", null, SettingLevel.DEVICE, Layout.IRC);

        // Wait until configuration is finished
        cy.contains(
            ".mx_RoomView_body .mx_GenericEventListSummary .mx_GenericEventListSummary_summary",
            "created and configured the room.",
        );

        // Click "expand" link button
        cy.get(".mx_GenericEventListSummary_toggle[aria-expanded=false]").click();
    });

    it("should render the Rooms list in reverse chronological order by default and allowing sorting A-Z", () => {
        // create rooms and check room names are correct
        cy.createRoom({ name: "Apple" }).then(()=>cy.contains(".mx_RoomSublist", "Apple"));
        cy.createRoom({ name: "Pineapple" }).then(()=>cy.contains(".mx_RoomSublist", "Pineapple"));
        cy.createRoom({ name: "Orange" }).then(()=>cy.contains(".mx_RoomSublist", "Orange"));
        // check the rooms are in the right order
        cy.get(".mx_RoomTile").should('have.length', 4); // due to the Test Room in beforeEach
        checkOrder([
            "Orange", "Pineapple", "Apple", "Test Room",
        ]);

        cy.contains(".mx_RoomSublist", "Rooms").find(".mx_RoomSublist_menuButton").click({force: true});
        cy.contains("A-Z").click();
        cy.get('.mx_StyledRadioButton_checked').should("contain.text", "A-Z");
        checkOrder([
            "Apple", "Orange", "Pineapple", "Test Room",
        ]);
    });

    it("should move rooms around as new events arrive", () => {
        // create rooms and check room names are correct
        cy.createRoom({ name: "Apple" }).as("roomA").then(()=>cy.contains(".mx_RoomSublist", "Apple"));
        cy.createRoom({ name: "Pineapple" }).as("roomP").then(()=>cy.contains(".mx_RoomSublist", "Pineapple"));
        cy.createRoom({ name: "Orange" }).as("roomO").then(()=>cy.contains(".mx_RoomSublist", "Orange"));

        // Select the Test Room
        cy.contains(".mx_RoomTile", "Test Room").click();

        checkOrder([
            "Orange", "Pineapple", "Apple", "Test Room",
        ]);
        bumpRoom("@roomA");
        checkOrder([
            "Apple", "Orange", "Pineapple", "Test Room",
        ]);
        bumpRoom("@roomO");
        checkOrder([
            "Orange", "Apple", "Pineapple", "Test Room",
        ]);
        bumpRoom("@roomO");
        checkOrder([
            "Orange", "Apple", "Pineapple", "Test Room",
        ]);
        bumpRoom("@roomP");
        checkOrder([
            "Pineapple", "Orange", "Apple", "Test Room",
        ]);
    });

    it("should not move the selected room: it should be sticky", () => {
        // create rooms and check room names are correct
        cy.createRoom({ name: "Apple" }).as("roomA").then(()=>cy.contains(".mx_RoomSublist", "Apple"));
        cy.createRoom({ name: "Pineapple" }).as("roomP").then(()=>cy.contains(".mx_RoomSublist", "Pineapple"));
        cy.createRoom({ name: "Orange" }).as("roomO").then(()=>cy.contains(".mx_RoomSublist", "Orange"));

        // Given a list of Orange, Pineapple, Apple - if Pineapple is active and a message is sent in Apple, the list should
        // turn into Apple, Pineapple, Orange - the index position of Pineapple never changes even though the list should technically
        // be Apple, Orange Pineapple - only when you click on a different room do things reshuffle.

        // Select the Pineapple room
        cy.contains(".mx_RoomTile", "Pineapple").click();
        checkOrder([
            "Orange", "Pineapple", "Apple", "Test Room",
        ]);

        // Move Apple
        bumpRoom("@roomA");
        checkOrder([
            "Apple", "Pineapple", "Orange", "Test Room",
        ]);

        // Select the Test Room
        cy.contains(".mx_RoomTile", "Test Room").click();

        // the rooms reshuffle to match reality
        checkOrder([
            "Apple", "Orange", "Pineapple", "Test Room",
        ]);
    });

    it.only("should show the right unread notifications", () => {
        createAndJoinBob();

        // send a message in the test room: unread notif count shoould increment
        cy.all([cy.get<string>("@roomId"), cy.get<MatrixClient>("@bob")]).then(([roomId, bob]) => {
            return bob.sendTextMessage(roomId, "Hello World");
        });

        // check that there is an unread notification (grey) as 1
        cy.contains(".mx_RoomTile", "Test Room").contains(".mx_NotificationBadge_count", "1");
        cy.get(".mx_NotificationBadge").should("not.have.class", "mx_NotificationBadge_highlighted");
        
        // send an @mention: highlight count (red) should be 2.
        cy.all([cy.get<string>("@roomId"), cy.get<MatrixClient>("@bob")]).then(([roomId, bob]) => {
            return bob.sendTextMessage(roomId, "Hello Sloth");
        });
        cy.contains(".mx_RoomTile", "Test Room").contains(".mx_NotificationBadge_count", "2");
        cy.get(".mx_NotificationBadge").should("have.class", "mx_NotificationBadge_highlighted");

        // click on the room, the notif counts should disappear
        cy.contains(".mx_RoomTile", "Test Room").click();
        cy.contains(".mx_RoomTile", "Test Room").should("not.have.class", "mx_NotificationBadge_count");
    });

    it("should not show unread indicators", () => {
        createAndJoinBob();

        // disable notifs in this room (TODO: CS API call?)
        cy.contains(".mx_RoomTile", "Test Room").find(".mx_RoomTile_notificationsButton").click({force: true});
        cy.contains("None").click();

        // create a new room so we know when the message has been received as it'll re-shuffle the room list
        cy.createRoom({
            name: "Dummy",
        });
        checkOrder([
            "Dummy", "Test Room",
        ]);

        cy.all([cy.get<string>("@roomId"), cy.get<MatrixClient>("@bob")]).then(([roomId, bob]) => {
            return bob.sendTextMessage(roomId, "Do you read me?");
        });
        // wait for this message to arrive, tell by the room list resorting
        checkOrder([
            "Test Room", "Dummy",
        ]);

        cy.contains(".mx_RoomTile", "Test Room").find(".mx_NotificationBadge").should("not.have.class", "mx_NotificationBadge_dot");
    });
});
