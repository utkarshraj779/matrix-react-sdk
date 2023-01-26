/*
Copyright 2023 The Matrix.org Foundation C.I.C.

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

import { EventType, MatrixEvent, RelationType, Room } from "matrix-js-sdk/src/matrix";
import { MatrixClient } from "matrix-js-sdk/src/client";
import { mocked } from "jest-mock";

import { isRelatedToVoiceBroadcast, VoiceBroadcastInfoState } from "../../../src/voice-broadcast";
import { mkEvent, stubClient } from "../../test-utils";
import { mkVoiceBroadcastInfoStateEvent } from "./test-utils";

const mkRelatedEvent = (room: Room, relatesTo: MatrixEvent, client: MatrixClient): MatrixEvent => {
    const event = mkEvent({
        event: true,
        type: EventType.RoomMessage,
        room: room.roomId,
        content: {},
        user: client.getSafeUserId(),
        relatesTo: {
            rel_type: RelationType.Reference,
            event_id: relatesTo.getId(),
        },
    });
    room.addLiveEvents([event]);
    return event;
};

describe("isRelatedToVoiceBroadcast", () => {
    const roomId = "!room:example.com";
    let client: MatrixClient;
    let room: Room;
    let broadcastEvent: MatrixEvent;
    let nonBroadcastEvent: MatrixEvent;

    beforeAll(() => {
        client = stubClient();
        room = new Room(roomId, client, client.getSafeUserId());

        mocked(client.getRoom).mockImplementation((getRoomId: string): Room | null => {
            if (getRoomId === roomId) return room;
            return null;
        });

        broadcastEvent = mkVoiceBroadcastInfoStateEvent(
            roomId,
            VoiceBroadcastInfoState.Started,
            client.getSafeUserId(),
            "ABC123",
        );
        nonBroadcastEvent = mkEvent({
            event: true,
            type: EventType.RoomMessage,
            room: roomId,
            content: {},
            user: client.getSafeUserId(),
        });

        room.addLiveEvents([broadcastEvent, nonBroadcastEvent]);
    });

    it("should return true if related to a broadcast event", () => {
        expect(isRelatedToVoiceBroadcast(mkRelatedEvent(room, broadcastEvent, client), client)).toBe(true);
    });

    it("should return false for an unknown room", () => {
        const otherRoom = new Room("!other:example.com", client, client.getSafeUserId());
        expect(isRelatedToVoiceBroadcast(mkRelatedEvent(otherRoom, broadcastEvent, client), client)).toBe(false);
    });
});
