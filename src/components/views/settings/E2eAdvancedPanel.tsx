/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import React from 'react';

import { _t } from "../../../languageHandler";
import { MatrixClientPeg } from '../../../MatrixClientPeg';
import { SettingLevel } from "../../../settings/SettingLevel";
import SettingsStore from "../../../settings/SettingsStore";
import SettingsFlag from '../elements/SettingsFlag';

const SETTING_MANUALLY_VERIFY_ALL_SESSIONS = "e2ee.manuallyVerifyAllSessions";

function updateBlacklistDevicesFlag(checked: boolean): void {
    MatrixClientPeg.get().setGlobalBlacklistUnverifiedDevices(checked);
};

const E2eAdvancedPanel = props => {
    const blacklistUnverifiedDevices = SettingsStore.isEnabled("blacklistUnverifiedDevices") ?
        <SettingsFlag
            name='blacklistUnverifiedDevices'
            level={SettingLevel.DEVICE}
            onChange={updateBlacklistDevicesFlag}
        /> : null;

    const manuallyVerifyAllSessions = SettingsStore.isEnabled(SETTING_MANUALLY_VERIFY_ALL_SESSIONS) ?
        <>
            <SettingsFlag name={SETTING_MANUALLY_VERIFY_ALL_SESSIONS}
                level={SettingLevel.DEVICE}
            />
            <div className="mx_E2eAdvancedPanel_settingLongDescription">{ _t(
                "Individually verify each session used by a user to mark it as trusted, not trusting cross-signed devices.",
            ) }</div>
        </> : null;

    return <div className="mx_SettingsTab_section">
        <span className="mx_SettingsTab_subheading">{ _t("Trust") }</span>
        { manuallyVerifyAllSessions }
        { blacklistUnverifiedDevices }
    </div>;
};

export default E2eAdvancedPanel;

export function isE2eAdvancedPanelPossible(): boolean {
    return SettingsStore.isEnabled(SETTING_MANUALLY_VERIFY_ALL_SESSIONS) || SettingsStore.isEnabled("blacklistUnverifiedDevices");
}
