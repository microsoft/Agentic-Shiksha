import { useChatStore } from "@/lib/chatStore";
import { useShallow } from "zustand/react/shallow";
import { SettingsView } from "./SettingsView";

export function SettingsPage() {
  const { userName, userNickname, userDepartment, userCollege, userWorkFunction, userPreferences, userCustomInstructions, userLanguage, userCurrentLocation, userPassionateAbout, uiLanguage, responseLanguage, setUserName, setUserNickname, setUserDepartment, setUserCollege, setUserWorkFunction, setUserPreferences, setUserCustomInstructions, setUserLanguage, setUserCurrentLocation, setUserPassionateAbout, setUiLanguage, setResponseLanguage } = useChatStore(
    useShallow((s) => ({
      userName: s.userName,
      userNickname: s.userNickname,
      userDepartment: s.userDepartment,
      userCollege: s.userCollege,
      userWorkFunction: s.userWorkFunction,
      userPreferences: s.userPreferences,
      userCustomInstructions: s.userCustomInstructions,
      userLanguage: s.userLanguage,
      userCurrentLocation: s.userCurrentLocation,
      userPassionateAbout: s.userPassionateAbout,
      uiLanguage: s.uiLanguage,
      responseLanguage: s.responseLanguage,
      setUserName: s.setUserName,
      setUserNickname: s.setUserNickname,
      setUserDepartment: s.setUserDepartment,
      setUserCollege: s.setUserCollege,
      setUserWorkFunction: s.setUserWorkFunction,
      setUserPreferences: s.setUserPreferences,
      setUserCustomInstructions: s.setUserCustomInstructions,
      setUserLanguage: s.setUserLanguage,
      setUserCurrentLocation: s.setUserCurrentLocation,
      setUserPassionateAbout: s.setUserPassionateAbout,
      setUiLanguage: s.setUiLanguage,
      setResponseLanguage: s.setResponseLanguage,
    }))
  );

  return (
    <SettingsView
      userName={userName}
      userNickname={userNickname}
      department={userDepartment}
      college={userCollege}
      workFunction={userWorkFunction}
      preferences={userPreferences}
      customInstructions={userCustomInstructions}
      language={userLanguage}
      currentLocation={userCurrentLocation}
      passionateAbout={userPassionateAbout}
      onUserNameChange={setUserName}
      onUserNicknameChange={setUserNickname}
      onDepartmentChange={setUserDepartment}
      onCollegeChange={setUserCollege}
      onWorkFunctionChange={setUserWorkFunction}
      onPreferencesChange={setUserPreferences}
      onCustomInstructionsChange={setUserCustomInstructions}
      onLanguageChange={setUserLanguage}
      onCurrentLocationChange={setUserCurrentLocation}
      onPassionateAboutChange={setUserPassionateAbout}
      uiLanguage={uiLanguage}
      responseLanguage={responseLanguage}
      onUiLanguageChange={setUiLanguage}
      onResponseLanguageChange={setResponseLanguage}
    />
  );
}
