import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/ThemeProvider";

type SettingsTab = "general" | "account" | "privacy";

type SettingsViewProps = {
  userName: string;
  userNickname: string;
  department: string;
  college: string;
  workFunction: string;
  preferences: string;
  customInstructions: string;
  language: string;
  currentLocation: string;
  passionateAbout: string;
  uiLanguage: string;
  responseLanguage: string;
  onUserNameChange: (name: string) => void;
  onUserNicknameChange: (nickname: string) => void;
  onDepartmentChange: (department: string) => void;
  onCollegeChange: (college: string) => void;
  onWorkFunctionChange: (fn: string) => void;
  onPreferencesChange: (prefs: string) => void;
  onCustomInstructionsChange: (instructions: string) => void;
  onLanguageChange: (language: string) => void;
  onCurrentLocationChange: (location: string) => void;
  onPassionateAboutChange: (about: string) => void;
  onUiLanguageChange: (lang: string) => void;
  onResponseLanguageChange: (lang: string) => void;
};

export function SettingsView({
  userName,
  userNickname,
  department,
  college,
  workFunction,
  preferences,
  customInstructions,
  language,
  currentLocation,
  passionateAbout,
  onUserNameChange,
  onUserNicknameChange,
  onDepartmentChange,
  onCollegeChange,
  onWorkFunctionChange,
  onPreferencesChange,
  onCustomInstructionsChange,
  onLanguageChange,
  onCurrentLocationChange,
  onPassionateAboutChange,
  uiLanguage,
  responseLanguage,
  onUiLanguageChange,
  onResponseLanguageChange,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("general");
  const { theme, setTheme } = useTheme();

  // Shared dropdown styles
  const dropdownStyles = {
    trigger: "bg-neutral-900/60 border-neutral-700/60 text-neutral-400 rounded-lg h-10",
    content: "bg-neutral-800 border-neutral-700",
    item: "text-neutral-200 focus:bg-neutral-700 focus:text-white",
  };

  // Known dropdown options
  const knownColleges = ["IISc", "IIT Bombay", "IIT Delhi", "IIT Madras", "IIT Kanpur", "IIT Kharagpur", "IIT Hyderabad", "IIT Roorkee", "IIIT Hyderabad", "NIT Trichy", "NIT Warangal", "BITS Pilani", "Delhi University", "Anna University", "VTU"];
  const knownDepartments = ["Computer Science", "Electronics & Communication", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering", "Information Technology", "Data Science", "Artificial Intelligence", "Mathematics", "Physics", "Chemistry", "Biotechnology"];

  const toDropdownState = (value: string, knownValues: string[]) => {
    if (!value) return { dropdown: "", custom: "" };
    if (knownValues.includes(value)) return { dropdown: value, custom: "" };
    return { dropdown: "other", custom: value };
  };
  
  // Track initial values to detect changes
  const [initialValues, setInitialValues] = React.useState({
    userName,
    userNickname,
    department,
    college,
    workFunction,
    preferences,
    customInstructions,
    language,
    currentLocation,
    passionateAbout,
  });
  
  // Local state for editing
  const [localUserName, setLocalUserName] = React.useState(userName);
  const [localUserNickname, setLocalUserNickname] = React.useState(userNickname);
  const [localDepartment, setLocalDepartment] = React.useState(() => toDropdownState(department, knownDepartments).dropdown);
  const [localDepartmentCustom, setLocalDepartmentCustom] = React.useState(() => toDropdownState(department, knownDepartments).custom);
  const [localCollege, setLocalCollege] = React.useState(() => toDropdownState(college, knownColleges).dropdown);
  const [localCollegeCustom, setLocalCollegeCustom] = React.useState(() => toDropdownState(college, knownColleges).custom);
  const [localWorkFunction, setLocalWorkFunction] = React.useState(workFunction);
  const [localPreferences, setLocalPreferences] = React.useState(preferences);
  const [localCustomInstructions, setLocalCustomInstructions] = React.useState(customInstructions);
  const [localLanguage, setLocalLanguage] = React.useState(language);
  const [localCurrentLocation, setLocalCurrentLocation] = React.useState(currentLocation);
  const [localPassionateAbout, setLocalPassionateAbout] = React.useState(passionateAbout);
  
  // Reset local state when props change
  React.useEffect(() => {
    setLocalUserName(userName);
    setLocalUserNickname(userNickname);
    const deptState = toDropdownState(department, knownDepartments);
    setLocalDepartment(deptState.dropdown);
    setLocalDepartmentCustom(deptState.custom);
    const collegeState = toDropdownState(college, knownColleges);
    setLocalCollege(collegeState.dropdown);
    setLocalCollegeCustom(collegeState.custom);
    setLocalWorkFunction(workFunction);
    setLocalPreferences(preferences);
    setLocalCustomInstructions(customInstructions);
    setLocalLanguage(language);
    setLocalCurrentLocation(currentLocation);
    setLocalPassionateAbout(passionateAbout);
    setInitialValues({
      userName,
      userNickname,
      department,
      college,
      workFunction,
      preferences,
      customInstructions,
      language,
      currentLocation,
      passionateAbout,
    });
  }, [userName, userNickname, department, college, workFunction, preferences, customInstructions, language, currentLocation, passionateAbout]);
  
  // Check if there are unsaved changes
  const hasChanges = 
    localUserName !== initialValues.userName ||
    localUserNickname !== initialValues.userNickname ||
    localDepartment !== initialValues.department ||
    localCollege !== initialValues.college ||
    localWorkFunction !== initialValues.workFunction ||
    localPreferences !== initialValues.preferences ||
    localCustomInstructions !== initialValues.customInstructions ||
    localLanguage !== initialValues.language ||
    localCurrentLocation !== initialValues.currentLocation ||
    localPassionateAbout !== initialValues.passionateAbout;
  
  const handleSave = () => {
    onUserNameChange(localUserName);
    onUserNicknameChange(localUserNickname);
    onDepartmentChange(localDepartment === "other" ? localDepartmentCustom : localDepartment);
    onCollegeChange(localCollege === "other" ? localCollegeCustom : localCollege);
    onWorkFunctionChange(localWorkFunction);
    onPreferencesChange(localPreferences);
    onCustomInstructionsChange(localCustomInstructions);
    onLanguageChange(localLanguage);
    onCurrentLocationChange(localCurrentLocation);
    onPassionateAboutChange(localPassionateAbout);
    setInitialValues({
      userName: localUserName,
      userNickname: localUserNickname,
      department: localDepartment,
      college: localCollege,
      workFunction: localWorkFunction,
      preferences: localPreferences,
      customInstructions: localCustomInstructions,
      language: localLanguage,
      currentLocation: localCurrentLocation,
      passionateAbout: localPassionateAbout,
    });
  };
  
  const handleCancel = () => {
    setLocalUserName(initialValues.userName);
    setLocalUserNickname(initialValues.userNickname);
    setLocalDepartment(toDropdownState(initialValues.department, knownDepartments).dropdown);
    setLocalDepartmentCustom(toDropdownState(initialValues.department, knownDepartments).custom);
    setLocalCollege(toDropdownState(initialValues.college, knownColleges).dropdown);
    setLocalCollegeCustom(toDropdownState(initialValues.college, knownColleges).custom);
    setLocalWorkFunction(initialValues.workFunction);
    setLocalPreferences(initialValues.preferences);
    setLocalCustomInstructions(initialValues.customInstructions);
    setLocalLanguage(initialValues.language);
    setLocalCurrentLocation(initialValues.currentLocation);
    setLocalPassionateAbout(initialValues.passionateAbout);
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "account", label: "Account" },
    { id: "privacy", label: "Privacy" },
  ];

  // Get initials from full name
  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header + Tabs */}
      <div>
        <div className="max-w-3xl mx-auto px-8 pt-8 pb-0">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
            {hasChanges && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={handleCancel}
                  className="text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 h-8 px-3 text-sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  className="bg-white hover:bg-neutral-200 text-neutral-900 h-8 px-4 text-sm"
                >
                  Save
                </Button>
              </div>
            )}
          </div>
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`pb-3 text-sm font-medium transition-colors outline-none relative ${
                  activeTab === tab.id
                    ? "text-white"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                )}
              </button>
            ))}
          </nav>
          <div className="border-b border-neutral-800 mt-0" />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-7">
            {activeTab === "general" && (
              <div className="space-y-8">
                {/* Profile section */}
                <div>
                  <h3 className="text-base font-semibold text-white mb-4">Profile</h3>

                  {/* Full name and Nickname */}
                  <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Full Name</label>
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-full bg-neutral-600 flex items-center justify-center text-neutral-200 text-sm font-semibold flex-shrink-0">
                        {getInitials(localUserName)}
                      </div>
                      <Input
                        value={localUserName}
                        onChange={(e) => setLocalUserName(e.target.value)}
                        placeholder="Your full name"
                        className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 outline-none focus-visible:ring-0 focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700/30 transition-all"
                    />
                  </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Preferred Name</label>
                    <Input
                      value={localUserNickname}
                      onChange={(e) => setLocalUserNickname(e.target.value)}
                      placeholder="What should we call you?"
                      className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 outline-none focus-visible:ring-0 focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700/30 transition-all"
                    />
                  </div>
                </div>
                </div>

                {/* Language and Location */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Language</label>
                    <Input
                      value={localLanguage}
                      onChange={(e) => setLocalLanguage(e.target.value)}
                      placeholder="e.g. English, Hindi, Tamil…"
                      className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 outline-none focus-visible:ring-0 focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700/30 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Location</label>
                    <Input
                      value={localCurrentLocation}
                      onChange={(e) => setLocalCurrentLocation(e.target.value)}
                      placeholder="e.g. Bangalore, Delhi, Mumbai…"
                      className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 outline-none focus-visible:ring-0 focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700/30 transition-all"
                    />
                  </div>
                </div>

                {/* College and Department */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">College / University</label>
                    <Select value={localCollege || ""} onValueChange={setLocalCollege} disabled>
                      <SelectTrigger className={`${dropdownStyles.trigger} opacity-60 cursor-not-allowed`}>
                        <SelectValue placeholder="Select your institution" />
                      </SelectTrigger>
                      <SelectContent className={dropdownStyles.content}>
                        <SelectItem value="IISc" className={dropdownStyles.item}>Indian Institute of Science</SelectItem>
                        <SelectItem value="IIT Bombay" className={dropdownStyles.item}>IIT Bombay</SelectItem>
                        <SelectItem value="IIT Delhi" className={dropdownStyles.item}>IIT Delhi</SelectItem>
                        <SelectItem value="IIT Madras" className={dropdownStyles.item}>IIT Madras</SelectItem>
                        <SelectItem value="IIT Kanpur" className={dropdownStyles.item}>IIT Kanpur</SelectItem>
                        <SelectItem value="IIT Kharagpur" className={dropdownStyles.item}>IIT Kharagpur</SelectItem>
                        <SelectItem value="IIT Hyderabad" className={dropdownStyles.item}>IIT Hyderabad</SelectItem>
                        <SelectItem value="IIT Roorkee" className={dropdownStyles.item}>IIT Roorkee</SelectItem>
                        <SelectItem value="IIIT Hyderabad" className={dropdownStyles.item}>IIIT Hyderabad</SelectItem>
                        <SelectItem value="NIT Trichy" className={dropdownStyles.item}>NIT Trichy</SelectItem>
                        <SelectItem value="NIT Warangal" className={dropdownStyles.item}>NIT Warangal</SelectItem>
                        <SelectItem value="BITS Pilani" className={dropdownStyles.item}>BITS Pilani</SelectItem>
                        <SelectItem value="Delhi University" className={dropdownStyles.item}>Delhi University</SelectItem>
                        <SelectItem value="Anna University" className={dropdownStyles.item}>Anna University</SelectItem>
                        <SelectItem value="VTU" className={dropdownStyles.item}>VTU</SelectItem>
                        <SelectItem value="other" className={dropdownStyles.item}>Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {localCollege === "other" && (
                      <Input
                        value={localCollegeCustom}
                        onChange={(e) => setLocalCollegeCustom(e.target.value)}
                        placeholder="Enter your institution name"
                        disabled
                        className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 mt-2 outline-none focus-visible:ring-0 focus:border-neutral-600 opacity-60 cursor-not-allowed"
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Department</label>
                    <Select value={localDepartment || ""} onValueChange={setLocalDepartment} disabled>
                      <SelectTrigger className={`${dropdownStyles.trigger} opacity-60 cursor-not-allowed`}>
                        <SelectValue placeholder="Select your department" />
                      </SelectTrigger>
                      <SelectContent className={dropdownStyles.content}>
                        <SelectItem value="Computer Science" className={dropdownStyles.item}>Computer Science</SelectItem>
                        <SelectItem value="Electronics & Communication" className={dropdownStyles.item}>Electronics & Communication</SelectItem>
                        <SelectItem value="Electrical Engineering" className={dropdownStyles.item}>Electrical Engineering</SelectItem>
                        <SelectItem value="Mechanical Engineering" className={dropdownStyles.item}>Mechanical Engineering</SelectItem>
                        <SelectItem value="Civil Engineering" className={dropdownStyles.item}>Civil Engineering</SelectItem>
                        <SelectItem value="Information Technology" className={dropdownStyles.item}>Information Technology</SelectItem>
                        <SelectItem value="Data Science" className={dropdownStyles.item}>Data Science</SelectItem>
                        <SelectItem value="Artificial Intelligence" className={dropdownStyles.item}>Artificial Intelligence</SelectItem>
                        <SelectItem value="Mathematics" className={dropdownStyles.item}>Mathematics</SelectItem>
                        <SelectItem value="Physics" className={dropdownStyles.item}>Physics</SelectItem>
                        <SelectItem value="Chemistry" className={dropdownStyles.item}>Chemistry</SelectItem>
                        <SelectItem value="Biotechnology" className={dropdownStyles.item}>Biotechnology</SelectItem>
                        <SelectItem value="other" className={dropdownStyles.item}>Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {localDepartment === "other" && (
                      <Input
                        value={localDepartmentCustom}
                        onChange={(e) => setLocalDepartmentCustom(e.target.value)}
                        placeholder="Enter your department name"
                        disabled
                        className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg h-10 mt-2 outline-none focus-visible:ring-0 focus:border-neutral-600 opacity-60 cursor-not-allowed"
                      />
                    )}
                  </div>
                </div>

                {/* Passionate About */}
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-neutral-400">Passionate About</label>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Describe a few things you're passionate about
                    </p>
                  </div>
                  <Textarea
                    value={localPassionateAbout}
                    onChange={(e) => setLocalPassionateAbout(e.target.value)}
                    placeholder="e.g. Machine learning, embedded systems, mathematics…"
                    className="bg-neutral-900/60 border-neutral-700/60 text-neutral-100 placeholder:text-neutral-600 rounded-lg min-h-[80px] resize-none outline-none focus-visible:ring-0 focus:border-neutral-600 focus:ring-1 focus:ring-neutral-700/30 transition-all"
                  />
                </div>

                <div className="border-b border-neutral-800 -mb-4" />

                {/* Preferences */}
                <div className="space-y-6">
                  <h3 className="text-base font-semibold text-white mb-4">Preferences</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-neutral-400">Theme</label>
                      <p className="text-xs text-neutral-500 mt-0.5">Choose how Shiksha looks on your device</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {(["light", "system", "dark"] as const).map((t) => {
                        const isSelected = theme === t;
                        const base = "flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all text-xs font-medium";
                        const unselected = "bg-transparent border-neutral-700/60 text-neutral-500 hover:border-neutral-600 hover:text-neutral-400";
                        const selectedStyles = t === "light"
                          ? "bg-neutral-300 border-neutral-600 text-neutral-900"
                          : t === "dark"
                            ? "bg-neutral-950 border-neutral-600 text-neutral-200"
                            : "bg-neutral-750 border-neutral-750 text-neutral-300";
                        return (
                          <button
                            key={t}
                            onClick={() => setTheme(t)}
                            className={`${base} ${isSelected ? selectedStyles : unselected}`}
                          >
                          {/* Icon */}
                          {t === "light" && (
                            <svg className="size-3.5" viewBox="0 0 16 16" fill="none">
                              <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {t === "system" && (
                            <svg className="size-3.5" viewBox="0 0 16 16" fill="none">
                              <rect x="2" y="3" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                              <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                          )}
                          {t === "dark" && (
                            <svg className="size-3.5" viewBox="0 0 16 16" fill="none">
                              <path d="M13.5 9.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                            </svg>
                          )}
                          <span className="capitalize">{t}</span>
                        </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Language */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-neutral-400">Language</label>
                      <p className="text-xs text-neutral-500 mt-0.5">The language used in the user interface</p>
                    </div>
                    <Select value={uiLanguage} onValueChange={onUiLanguageChange}>
                      <SelectTrigger className={`w-48 ${dropdownStyles.trigger}`}>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent className={dropdownStyles.content}>
                        <SelectItem value="default" className={dropdownStyles.item}>Default</SelectItem>
                        <SelectItem value="en" className={dropdownStyles.item}>English</SelectItem>
                        <SelectItem value="hi" className={dropdownStyles.item}>Hindi</SelectItem>
                        <SelectItem value="as" className={dropdownStyles.item}>Assamese</SelectItem>
                        <SelectItem value="bn" className={dropdownStyles.item}>Bengali</SelectItem>
                        <SelectItem value="bo" className={dropdownStyles.item}>Bodo</SelectItem>
                        <SelectItem value="doi" className={dropdownStyles.item}>Dogri</SelectItem>
                        <SelectItem value="gu" className={dropdownStyles.item}>Gujarati</SelectItem>
                        <SelectItem value="kn" className={dropdownStyles.item}>Kannada</SelectItem>
                        <SelectItem value="ks" className={dropdownStyles.item}>Kashmiri</SelectItem>
                        <SelectItem value="kok" className={dropdownStyles.item}>Konkani</SelectItem>
                        <SelectItem value="mai" className={dropdownStyles.item}>Maithili</SelectItem>
                        <SelectItem value="ml" className={dropdownStyles.item}>Malayalam</SelectItem>
                        <SelectItem value="mni" className={dropdownStyles.item}>Manipuri</SelectItem>
                        <SelectItem value="mr" className={dropdownStyles.item}>Marathi</SelectItem>
                        <SelectItem value="ne" className={dropdownStyles.item}>Nepali</SelectItem>
                        <SelectItem value="or" className={dropdownStyles.item}>Odia</SelectItem>
                        <SelectItem value="pa" className={dropdownStyles.item}>Punjabi</SelectItem>
                        <SelectItem value="sa" className={dropdownStyles.item}>Sanskrit</SelectItem>
                        <SelectItem value="sat" className={dropdownStyles.item}>Santali</SelectItem>
                        <SelectItem value="sd" className={dropdownStyles.item}>Sindhi</SelectItem>
                        <SelectItem value="ta" className={dropdownStyles.item}>Tamil</SelectItem>
                        <SelectItem value="te" className={dropdownStyles.item}>Telugu</SelectItem>
                        <SelectItem value="ur" className={dropdownStyles.item}>Urdu</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Preferred response language */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-neutral-400">Preferred response language</label>
                      <p className="text-xs text-neutral-500 mt-0.5">The language used for AI responses</p>
                    </div>
                    <Select value={responseLanguage} onValueChange={onResponseLanguageChange}>
                      <SelectTrigger className={`w-48 ${dropdownStyles.trigger}`}>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent className={dropdownStyles.content}>
                        <SelectItem value="auto" className={dropdownStyles.item}>Automatic (detect input)</SelectItem>
                        <SelectItem value="en" className={dropdownStyles.item}>English</SelectItem>
                        <SelectItem value="hi" className={dropdownStyles.item}>Hindi</SelectItem>
                        <SelectItem value="as" className={dropdownStyles.item}>Assamese</SelectItem>
                        <SelectItem value="bn" className={dropdownStyles.item}>Bengali</SelectItem>
                        <SelectItem value="bo" className={dropdownStyles.item}>Bodo</SelectItem>
                        <SelectItem value="doi" className={dropdownStyles.item}>Dogri</SelectItem>
                        <SelectItem value="gu" className={dropdownStyles.item}>Gujarati</SelectItem>
                        <SelectItem value="kn" className={dropdownStyles.item}>Kannada</SelectItem>
                        <SelectItem value="ks" className={dropdownStyles.item}>Kashmiri</SelectItem>
                        <SelectItem value="kok" className={dropdownStyles.item}>Konkani</SelectItem>
                        <SelectItem value="mai" className={dropdownStyles.item}>Maithili</SelectItem>
                        <SelectItem value="ml" className={dropdownStyles.item}>Malayalam</SelectItem>
                        <SelectItem value="mni" className={dropdownStyles.item}>Manipuri</SelectItem>
                        <SelectItem value="mr" className={dropdownStyles.item}>Marathi</SelectItem>
                        <SelectItem value="ne" className={dropdownStyles.item}>Nepali</SelectItem>
                        <SelectItem value="or" className={dropdownStyles.item}>Odia</SelectItem>
                        <SelectItem value="pa" className={dropdownStyles.item}>Punjabi</SelectItem>
                        <SelectItem value="sa" className={dropdownStyles.item}>Sanskrit</SelectItem>
                        <SelectItem value="sat" className={dropdownStyles.item}>Santali</SelectItem>
                        <SelectItem value="sd" className={dropdownStyles.item}>Sindhi</SelectItem>
                        <SelectItem value="ta" className={dropdownStyles.item}>Tamil</SelectItem>
                        <SelectItem value="te" className={dropdownStyles.item}>Telugu</SelectItem>
                        <SelectItem value="ur" className={dropdownStyles.item}>Urdu</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "account" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">Account</h3>
                <p className="text-sm text-neutral-500">
                  Account settings will be available soon.
                </p>
              </div>
            )}

            {activeTab === "privacy" && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white">Privacy</h3>
                <p className="text-sm text-neutral-500">
                  Privacy settings will be available soon.
                </p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
