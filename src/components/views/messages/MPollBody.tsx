/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import React from "react";
import classNames from "classnames";
import { logger } from "matrix-js-sdk/src/logger";
import { MatrixEvent } from "matrix-js-sdk/src/models/event";
import { Relations } from "matrix-js-sdk/src/models/relations";
import { MatrixClient } from "matrix-js-sdk/src/matrix";
import { M_POLL_END, M_POLL_KIND_DISCLOSED, M_POLL_RESPONSE, M_POLL_START } from "matrix-js-sdk/src/@types/polls";
import { RelatedRelations } from "matrix-js-sdk/src/models/related-relations";
import { PollStartEvent, PollAnswerSubevent } from "matrix-js-sdk/src/extensible_events_v1/PollStartEvent";
import { PollResponseEvent } from "matrix-js-sdk/src/extensible_events_v1/PollResponseEvent";
import { Poll, PollEvent } from "matrix-js-sdk/src/models/poll";

import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";
import { IBodyProps } from "./IBodyProps";
import { formatCommaSeparatedList } from "../../../utils/FormattingUtils";
import StyledRadioButton from "../elements/StyledRadioButton";
import MatrixClientContext from "../../../contexts/MatrixClientContext";
import ErrorDialog from "../dialogs/ErrorDialog";
import { GetRelationsForEvent } from "../rooms/EventTile";
import PollCreateDialog from "../elements/PollCreateDialog";
import { MatrixClientPeg } from "../../../MatrixClientPeg";

interface IState {
    poll?: Poll;
    pollReady: boolean;
    selected?: string | null | undefined; // Which option was clicked by the local user
    voteRelations?: Relations; // Voting (response) events
}

export function createVoteRelations(getRelationsForEvent: GetRelationsForEvent, eventId: string): RelatedRelations {
    const relationsList: Relations[] = [];

    const pollResponseRelations = getRelationsForEvent(eventId, "m.reference", M_POLL_RESPONSE.name);
    if (pollResponseRelations) {
        relationsList.push(pollResponseRelations);
    }

    const pollResposnseAltRelations = getRelationsForEvent(eventId, "m.reference", M_POLL_RESPONSE.altName);
    if (pollResposnseAltRelations) {
        relationsList.push(pollResposnseAltRelations);
    }

    return new RelatedRelations(relationsList);
}

export function findTopAnswer(pollEvent: MatrixEvent, voteRelations: Relations): string {
    const pollEventId = pollEvent.getId();
    if (!pollEventId) {
        logger.warn(
            "findTopAnswer: Poll event needs an event ID to fetch relations in order to determine " +
                "the top answer - assuming no best answer",
        );
        return "";
    }

    const poll = pollEvent.unstableExtensibleEvent as PollStartEvent;
    if (!poll?.isEquivalentTo(M_POLL_START)) {
        logger.warn("Failed to parse poll to determine top answer - assuming no best answer");
        return "";
    }

    const findAnswerText = (answerId: string): string => {
        return poll.answers.find((a) => a.id === answerId)?.text ?? "";
    };

    const userVotes: Map<string, UserVote> = collectUserVotes(allVotes(voteRelations));

    const votes: Map<string, number> = countVotes(userVotes, poll);
    const highestScore: number = Math.max(...votes.values());

    const bestAnswerIds: string[] = [];
    for (const [answerId, score] of votes) {
        if (score == highestScore) {
            bestAnswerIds.push(answerId);
        }
    }

    const bestAnswerTexts = bestAnswerIds.map(findAnswerText);

    return formatCommaSeparatedList(bestAnswerTexts, 3);
}

export function isPollEnded(
    pollEvent: MatrixEvent,
    matrixClient: MatrixClient,
    getRelationsForEvent?: GetRelationsForEvent,
): boolean {
    if (!getRelationsForEvent) {
        return false;
    }

    const pollEventId = pollEvent.getId();
    if (!pollEventId) {
        logger.warn(
            "isPollEnded: Poll event must have event ID in order to determine whether it has ended " +
                "- assuming poll has not ended",
        );
        return false;
    }

    const roomId = pollEvent.getRoomId();
    if (!roomId) {
        logger.warn(
            "isPollEnded: Poll event must have room ID in order to determine whether it has ended " +
                "- assuming poll has not ended",
        );
        return false;
    }

    const roomCurrentState = matrixClient.getRoom(roomId)?.currentState;
    function userCanRedact(endEvent: MatrixEvent): boolean {
        const endEventSender = endEvent.getSender();
        return (
            endEventSender && roomCurrentState && roomCurrentState.maySendRedactionForEvent(pollEvent, endEventSender)
        );
    }

    const relationsList: Relations[] = [];

    const pollEndRelations = getRelationsForEvent(pollEventId, "m.reference", M_POLL_END.name);
    if (pollEndRelations) {
        relationsList.push(pollEndRelations);
    }

    const pollEndAltRelations = getRelationsForEvent(pollEventId, "m.reference", M_POLL_END.altName);
    if (pollEndAltRelations) {
        relationsList.push(pollEndAltRelations);
    }

    const endRelations = new RelatedRelations(relationsList);

    if (!endRelations) {
        return false;
    }

    const authorisedRelations = endRelations.getRelations().filter(userCanRedact);

    return authorisedRelations.length > 0;
}

export function pollAlreadyHasVotes(mxEvent: MatrixEvent, getRelationsForEvent?: GetRelationsForEvent): boolean {
    if (!getRelationsForEvent) return false;

    const eventId = mxEvent.getId();
    if (!eventId) return false;

    const voteRelations = createVoteRelations(getRelationsForEvent, eventId);
    return voteRelations.getRelations().length > 0;
}

export function launchPollEditor(mxEvent: MatrixEvent, getRelationsForEvent?: GetRelationsForEvent): void {
    if (pollAlreadyHasVotes(mxEvent, getRelationsForEvent)) {
        Modal.createDialog(ErrorDialog, {
            title: _t("Can't edit poll"),
            description: _t("Sorry, you can't edit a poll after votes have been cast."),
        });
    } else {
        Modal.createDialog(
            PollCreateDialog,
            {
                room: MatrixClientPeg.get().getRoom(mxEvent.getRoomId()),
                threadId: mxEvent.getThread()?.id ?? null,
                editingMxEvent: mxEvent,
            },
            "mx_CompoundDialog",
            false, // isPriorityModal
            true, // isStaticModal
        );
    }
}

export default class MPollBody extends React.Component<IBodyProps, IState> {
    public static contextType = MatrixClientContext;
    public context!: React.ContextType<typeof MatrixClientContext>;
    private seenEventIds: string[] = []; // Events we have already seen

    public constructor(props: IBodyProps) {
        super(props);

        this.state = {
            selected: null,
            pollReady: false,
        };
    }

    public componentDidMount(): void {
        const room = this.context.getRoom(this.props.mxEvent.getRoomId());
        const poll = room?.polls.get(this.props.mxEvent.getId());
        if (poll) {
            this.setPollInstance(poll);
        } else {
            room?.on(PollEvent.New, this.setPollInstance.bind(this));
        }
    }

    public componentWillUnmount(): void {
        this.removeListeners();
    }

    private async setPollInstance(poll: Poll): Promise<void> {
        if (poll.pollId !== this.props.mxEvent.getId()) {
            return;
        }
        this.setState({ poll }, () => {
            this.addListeners();
        });
        const responses = await poll.getResponses();
        const voteRelations = responses;

        this.setState({ pollReady: true, voteRelations });
    }

    private addListeners(): void {
        this.state.poll?.on(PollEvent.Responses, this.onResponsesChange);
        this.state.poll?.on(PollEvent.End, this.onRelationsChange);
    }

    private removeListeners(): void {
        if (this.state.poll) {
            this.state.poll.off(PollEvent.Responses, this.onResponsesChange);
            this.state.poll.off(PollEvent.End, this.onRelationsChange);
        }
    }

    private onResponsesChange = (responses: Relations): void => {
        this.setState({ voteRelations: responses });
        this.onRelationsChange();
    };

    private onRelationsChange = (): void => {
        // We hold Relations in our state, and they changed under us.
        // Check whether we should delete our selection, and then
        // re-render.
        // Note: re-rendering is a side effect of unselectIfNewEventFromMe().
        this.unselectIfNewEventFromMe();
    };

    private selectOption(answerId: string): void {
        if (this.state.poll?.isEnded) {
            return;
        }
        const userVotes = this.collectUserVotes();
        const userId = this.context.getUserId();
        const myVote = userVotes.get(userId)?.answers[0];
        if (answerId === myVote) {
            return;
        }

        const response = PollResponseEvent.from([answerId], this.props.mxEvent.getId()).serialize();

        this.context.sendEvent(this.props.mxEvent.getRoomId(), response.type, response.content).catch((e: any) => {
            console.error("Failed to submit poll response event:", e);

            Modal.createDialog(ErrorDialog, {
                title: _t("Vote not registered"),
                description: _t("Sorry, your vote was not registered. Please try again."),
            });
        });

        this.setState({ selected: answerId });
    }

    private onOptionSelected = (e: React.FormEvent<HTMLInputElement>): void => {
        this.selectOption(e.currentTarget.value);
    };

    /**
     * @returns userId -> UserVote
     */
    private collectUserVotes(): Map<string, UserVote> {
        return collectUserVotes(allVotes(this.state.voteRelations), this.context.getUserId(), this.state.selected);
    }

    /**
     * If we've just received a new event that we hadn't seen
     * before, and that event is me voting (e.g. from a different
     * device) then forget when the local user selected.
     *
     * Either way, calls setState to update our list of events we
     * have already seen.
     */
    private unselectIfNewEventFromMe(): void {
        // @TODO(kerrya) removed filter because vote relations are only poll responses now
        const newEvents: MatrixEvent[] = this.state.voteRelations
            .getRelations()
            .filter((mxEvent: MatrixEvent) => !this.seenEventIds.includes(mxEvent.getId()!));
        let newSelected = this.state.selected;

        if (newEvents.length > 0) {
            for (const mxEvent of newEvents) {
                if (mxEvent.getSender() === this.context.getUserId()) {
                    newSelected = null;
                }
            }
        }
        const newEventIds = newEvents.map((mxEvent: MatrixEvent) => mxEvent.getId());
        this.seenEventIds = this.seenEventIds.concat(newEventIds);
        this.setState({ selected: newSelected });
    }

    private totalVotes(collectedVotes: Map<string, number>): number {
        let sum = 0;
        for (const v of collectedVotes.values()) {
            sum += v;
        }
        return sum;
    }

    public render(): JSX.Element {
        const { poll, pollReady } = this.state;
        console.log("hhh", "MPollBody render", poll, pollReady);
        if (!poll?.pollEvent) {
            return null;
        }

        const pollEvent = poll.pollEvent;

        const pollId = this.props.mxEvent.getId();
        const userVotes = this.collectUserVotes();
        const votes = countVotes(userVotes, pollEvent);
        const totalVotes = this.totalVotes(votes);
        const winCount = Math.max(...votes.values());
        const userId = this.context.getUserId();
        const myVote = userVotes?.get(userId!)?.answers[0];
        const disclosed = M_POLL_KIND_DISCLOSED.matches(pollEvent.kind.name);

        // Disclosed: votes are hidden until I vote or the poll ends
        // Undisclosed: votes are hidden until poll ends
        const showResults = poll.isEnded || (disclosed && myVote !== undefined);

        let totalText: string;
        if (poll.isEnded) {
            totalText = _t("Final result based on %(count)s votes", { count: totalVotes });
        } else if (!disclosed) {
            totalText = _t("Results will be visible when the poll is ended");
        } else if (myVote === undefined) {
            if (totalVotes === 0) {
                totalText = _t("No votes cast");
            } else {
                totalText = _t("%(count)s votes cast. Vote to see the results", { count: totalVotes });
            }
        } else {
            totalText = _t("Based on %(count)s votes", { count: totalVotes });
        }

        const editedSpan = this.props.mxEvent.replacingEvent() ? (
            <span className="mx_MPollBody_edited"> ({_t("edited")})</span>
        ) : null;

        return (
            <div className="mx_MPollBody">
                <h2 data-testid="pollQuestion">
                    {pollEvent.question.text}
                    {editedSpan}
                </h2>
                <div className="mx_MPollBody_allOptions">
                    {pollEvent.answers.map((answer: PollAnswerSubevent) => {
                        let answerVotes = 0;
                        let votesText = "";

                        if (showResults) {
                            answerVotes = votes.get(answer.id) ?? 0;
                            votesText = _t("%(count)s votes", { count: answerVotes });
                        }

                        const checked =
                            (!poll.isEnded && myVote === answer.id) || (poll.isEnded && answerVotes === winCount);
                        const cls = classNames({
                            mx_MPollBody_option: true,
                            mx_MPollBody_option_checked: checked,
                            mx_MPollBody_option_ended: poll.isEnded,
                        });

                        const answerPercent = totalVotes === 0 ? 0 : Math.round((100.0 * answerVotes) / totalVotes);
                        return (
                            <div
                                data-testid={`pollOption-${answer.id}`}
                                key={answer.id}
                                className={cls}
                                onClick={() => this.selectOption(answer.id)}
                            >
                                {poll.isEnded ? (
                                    <EndedPollOption answer={answer} checked={checked} votesText={votesText} />
                                ) : (
                                    <LivePollOption
                                        pollId={pollId}
                                        answer={answer}
                                        checked={checked}
                                        votesText={votesText}
                                        onOptionSelected={this.onOptionSelected}
                                    />
                                )}
                                <div className="mx_MPollBody_popularityBackground">
                                    <div
                                        className="mx_MPollBody_popularityAmount"
                                        style={{ width: `${answerPercent}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div data-testid="totalVotes" className="mx_MPollBody_totalVotes">
                    {totalText}
                </div>
            </div>
        );
    }
}

interface IEndedPollOptionProps {
    answer: PollAnswerSubevent;
    checked: boolean;
    votesText: string;
}

function EndedPollOption(props: IEndedPollOptionProps): JSX.Element {
    const cls = classNames({
        mx_MPollBody_endedOption: true,
        mx_MPollBody_endedOptionWinner: props.checked,
    });
    return (
        <div className={cls} data-value={props.answer.id}>
            <div className="mx_MPollBody_optionDescription">
                <div className="mx_MPollBody_optionText">{props.answer.text}</div>
                <div className="mx_MPollBody_optionVoteCount">{props.votesText}</div>
            </div>
        </div>
    );
}

interface ILivePollOptionProps {
    pollId: string;
    answer: PollAnswerSubevent;
    checked: boolean;
    votesText: string;
    onOptionSelected: (e: React.FormEvent<HTMLInputElement>) => void;
}

function LivePollOption(props: ILivePollOptionProps): JSX.Element {
    return (
        <StyledRadioButton
            className="mx_MPollBody_live-option"
            name={`poll_answer_select-${props.pollId}`}
            value={props.answer.id}
            checked={props.checked}
            onChange={props.onOptionSelected}
        >
            <div className="mx_MPollBody_optionDescription">
                <div className="mx_MPollBody_optionText">{props.answer.text}</div>
                <div className="mx_MPollBody_optionVoteCount">{props.votesText}</div>
            </div>
        </StyledRadioButton>
    );
}

export class UserVote {
    public constructor(public readonly ts: number, public readonly sender: string, public readonly answers: string[]) {}
}

function userResponseFromPollResponseEvent(event: MatrixEvent): UserVote {
    const response = event.unstableExtensibleEvent as PollResponseEvent;
    if (!response?.isEquivalentTo(M_POLL_RESPONSE)) {
        throw new Error("Failed to parse Poll Response Event to determine user response");
    }

    return new UserVote(event.getTs(), event.getSender(), response.answerIds);
}

export function allVotes(voteRelations: Relations): Array<UserVote> {
    if (voteRelations) {
        return voteRelations.getRelations().map(userResponseFromPollResponseEvent);
    } else {
        return [];
    }
}

/**
 * Figure out the correct vote for each user.
 * @param userResponses current vote responses in the poll
 * @param {string?} userId The userId for which the `selected` option will apply to.
 *                  Should be set to the current user ID.
 * @param {string?} selected Local echo selected option for the userId
 * @returns a Map of user ID to their vote info
 */
function collectUserVotes(
    userResponses: Array<UserVote>,
    userId?: string | null | undefined,
    selected?: string | null | undefined,
): Map<string, UserVote> {
    const userVotes: Map<string, UserVote> = new Map();

    for (const response of userResponses) {
        const otherResponse = userVotes.get(response.sender);
        if (!otherResponse || otherResponse.ts < response.ts) {
            userVotes.set(response.sender, response);
        }
    }

    if (selected && userId) {
        userVotes.set(userId, new UserVote(0, userId, [selected]));
    }

    return userVotes;
}

function countVotes(userVotes: Map<string, UserVote>, pollStart: PollStartEvent): Map<string, number> {
    const collected = new Map<string, number>();

    for (const response of userVotes.values()) {
        const tempResponse = PollResponseEvent.from(response.answers, "$irrelevant");
        tempResponse.validateAgainst(pollStart);
        if (!tempResponse.spoiled) {
            for (const answerId of tempResponse.answerIds) {
                if (collected.has(answerId)) {
                    collected.set(answerId, collected.get(answerId) + 1);
                } else {
                    collected.set(answerId, 1);
                }
            }
        }
    }

    return collected;
}
