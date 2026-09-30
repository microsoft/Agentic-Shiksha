import * as React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
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
import { X } from "lucide-react";

type SettingsTab = "general" | "account" | "privacy";

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  userNickname: string;
  department: string;
  college: string;
  workFunction: string;
  preferences: string;
  onUserNameChange: (name: string) => void;
  onUserNicknameChange: (nickname: string) => void;
  onDepartmentChange: (department: string) => void;
  onCollegeChange: (college: string) => void;
  onWorkFunctionChange: (fn: string) => void;
  onPreferencesChange: (prefs: string) => void;
};

export function SettingsDialog({
  open,
  onOpenChange,
  userName,
  userNickname,
  department,
  college,
  workFunction,
  preferences,
  onUserNameChange,
  onUserNicknameChange,
  onDepartmentChange,
  onCollegeChange,
  onWorkFunctionChange,
  onPreferencesChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>("general");

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
  
  // Reset local state when dialog opens
  React.useEffect(() => {
    if (open) {
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
      setInitialValues({
        userName,
        userNickname,
        department,
        college,
        workFunction,
        preferences,
      });
    }
  }, [open, userName, userNickname, department, college, workFunction, preferences]);
  
  // Check if there are unsaved changes
  const hasChanges = 
    localUserName !== initialValues.userName ||
    localUserNickname !== initialValues.userNickname ||
    localDepartment !== initialValues.department ||
    localCollege !== initialValues.college ||
    localWorkFunction !== initialValues.workFunction ||
    localPreferences !== initialValues.preferences;
  
  const handleSave = () => {
    onUserNameChange(localUserName);
    onUserNicknameChange(localUserNickname);
    onDepartmentChange(localDepartment === "other" ? localDepartmentCustom : localDepartment);
    onCollegeChange(localCollege === "other" ? localCollegeCustom : localCollege);
    onWorkFunctionChange(localWorkFunction);
    onPreferencesChange(localPreferences);
    setInitialValues({
      userName: localUserName,
      userNickname: localUserNickname,
      department: localDepartment,
      college: localCollege,
      workFunction: localWorkFunction,
      preferences: localPreferences,
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-neutral-900 border-neutral-700 max-w-2xl p-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-700/50">
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors outline-none"
          >
            <X className="h-5 w-5" />
          </button>
          <AlertDialogHeader className="sr-only">
            <AlertDialogTitle>Settings</AlertDialogTitle>
            <AlertDialogDescription>
              Manage your profile and preferences
            </AlertDialogDescription>
          </AlertDialogHeader>
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
                className="bg-blue-600 hover:bg-blue-700 text-white h-8 px-4 text-sm"
              >
                Save
              </Button>
            </div>
          )}
        </div>

        {/* Content with sidebar */}
        <div className="flex min-h-[450px]">
          {/* Sidebar */}
          <div className="w-48 flex-shrink-0 border-r border-neutral-700/50 p-3">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors outline-none ${
                    activeTab === tab.id
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Main content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {activeTab === "general" && (
              <div className="space-y-6">
                {/* Profile Section */}
                <div>
                  <h3 className="text-lg font-medium text-neutral-100 mb-4">Profile</h3>
                  
                  <div className="grid grid-cols-2 gap-6">
                    {/* Full name */}
                    <div className="space-y-2">
                      <label className="text-sm text-neutral-400">Full name</label>
                      <div className="flex items-center gap-3">
                        <div className="size-10 rounded-full bg-neutral-700 flex items-center justify-center text-neutral-300 text-sm font-medium flex-shrink-0">
                          {getInitials(localUserName)}
                        </div>
                        <Input
                          value={localUserName}
                          onChange={(e) => setLocalUserName(e.target.value)}
                          placeholder="Your full name"
                          className="flex-1 bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500 rounded-xl"
                        />
                      </div>
                    </div>

                    {/* Nickname */}
                    <div className="space-y-2">
                      <label className="text-sm text-neutral-400">What should we call you?</label>
                      <Input
                        value={localUserNickname}
                        onChange={(e) => setLocalUserNickname(e.target.value)}
                        placeholder="Your preferred name"
                        className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500 rounded-xl"
                      />
                    </div>
                  </div>

                  {/* College and Department in a row */}
                  <div className="grid grid-cols-2 gap-6 mt-4">
                    {/* College / University */}
                    <div className="space-y-2">
                      <label className="text-sm text-neutral-400">College / University</label>
                      <Select value={localCollege || ""} onValueChange={setLocalCollege}>
                        <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100 rounded-xl">
                          <SelectValue placeholder="Select your institution" />
                        </SelectTrigger>
                        <SelectContent className="bg-neutral-800 border-neutral-700">
                          <SelectItem value="IISc" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Indian Institute of Science</SelectItem>
                          <SelectItem value="IIT Bombay" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Bombay</SelectItem>
                          <SelectItem value="IIT Delhi" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Delhi</SelectItem>
                          <SelectItem value="IIT Madras" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Madras</SelectItem>
                          <SelectItem value="IIT Kanpur" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Kanpur</SelectItem>
                          <SelectItem value="IIT Kharagpur" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Kharagpur</SelectItem>
                          <SelectItem value="IIT Hyderabad" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Hyderabad</SelectItem>
                          <SelectItem value="IIT Roorkee" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIT Roorkee</SelectItem>
                          <SelectItem value="IIIT Hyderabad" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">IIIT Hyderabad</SelectItem>
                          <SelectItem value="NIT Trichy" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">NIT Trichy</SelectItem>
                          <SelectItem value="NIT Warangal" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">NIT Warangal</SelectItem>
                          <SelectItem value="BITS Pilani" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">BITS Pilani</SelectItem>
                          <SelectItem value="Delhi University" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Delhi University</SelectItem>
                          <SelectItem value="Anna University" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Anna University</SelectItem>
                          <SelectItem value="VTU" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">VTU</SelectItem>
                          <SelectItem value="other" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      {localCollege === "other" && (
                        <Input
                          value={localCollegeCustom}
                          onChange={(e) => setLocalCollegeCustom(e.target.value)}
                          placeholder="Enter your institution name"
                          className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500 rounded-xl mt-2"
                        />
                      )}
                    </div>

                    {/* Department */}
                    <div className="space-y-2">
                      <label className="text-sm text-neutral-400">Department</label>
                      <Select value={localDepartment || ""} onValueChange={setLocalDepartment}>
                        <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100 rounded-xl">
                          <SelectValue placeholder="Select your department" />
                        </SelectTrigger>
                        <SelectContent className="bg-neutral-800 border-neutral-700">
                          <SelectItem value="Computer Science" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Computer Science</SelectItem>
                          <SelectItem value="Electronics & Communication" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Electronics & Communication</SelectItem>
                          <SelectItem value="Electrical Engineering" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Electrical Engineering</SelectItem>
                          <SelectItem value="Mechanical Engineering" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Mechanical Engineering</SelectItem>
                          <SelectItem value="Civil Engineering" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Civil Engineering</SelectItem>
                          <SelectItem value="Information Technology" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Information Technology</SelectItem>
                          <SelectItem value="Data Science" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Data Science</SelectItem>
                          <SelectItem value="Artificial Intelligence" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Artificial Intelligence</SelectItem>
                          <SelectItem value="Mathematics" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Mathematics</SelectItem>
                          <SelectItem value="Physics" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Physics</SelectItem>
                          <SelectItem value="Chemistry" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Chemistry</SelectItem>
                          <SelectItem value="Biotechnology" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Biotechnology</SelectItem>
                          <SelectItem value="other" className="text-neutral-200 focus:bg-neutral-700 focus:text-white">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      {localDepartment === "other" && (
                        <Input
                          value={localDepartmentCustom}
                          onChange={(e) => setLocalDepartmentCustom(e.target.value)}
                          placeholder="Enter your department name"
                          className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500 rounded-xl mt-2"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Base Style and Tone preference */}
                <div className="flex items-start justify-between gap-4 py-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-neutral-200">Base Style and Tone:</label>
                    <p className="text-xs text-neutral-500">Set the style and tone of how the agent responds to you.</p>
                  </div>
                  <Select value={localWorkFunction || "default"} onValueChange={setLocalWorkFunction}>
                    <SelectTrigger className="bg-neutral-800 border-neutral-700 text-neutral-100 rounded-lg h-9 w-[140px] shrink-0">
                      <SelectValue placeholder="Select tone" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-neutral-700">
                      <SelectItem value="default" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Balanced and adaptive">
                        Default
                      </SelectItem>
                      <SelectItem value="supportive" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Patient and encouraging">
                        Supportive
                      </SelectItem>
                      <SelectItem value="scholarly" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Academic and thorough">
                        Scholarly
                      </SelectItem>
                      <SelectItem value="socratic" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Questioning and thought-provoking">
                        Socratic
                      </SelectItem>
                      <SelectItem value="concise" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Brief and to the point">
                        Concise
                      </SelectItem>
                      <SelectItem value="enthusiastic" className="text-neutral-200 focus:bg-neutral-700 focus:text-white py-2.5" description="Energetic and motivating">
                        Enthusiastic
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* More about you */}
                <div className="space-y-2">
                  <label className="text-sm text-neutral-400">
                    Tell us <span className="underline underline-offset-2">more about you</span>
                  </label>
                  <p className="text-xs text-neutral-500">
                    Help us personalize your learning experience.
                  </p>
                  <Textarea
                    value={localPreferences}
                    onChange={(e) => setLocalPreferences(e.target.value)}
                    placeholder="e.g. I'm a visual learner, I prefer examples over theory, I like step-by-step explanations..."
                    className="bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500 rounded-xl min-h-[100px] resize-none"
                  />
                </div>
              </div>
            )}

            {activeTab === "account" && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-neutral-100">Account</h3>
                <p className="text-sm text-neutral-400">
                  Account settings will be available soon.
                </p>
              </div>
            )}

            {activeTab === "privacy" && (
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-neutral-100">Privacy</h3>
                <p className="text-sm text-neutral-400">
                  Privacy settings will be available soon.
                </p>
              </div>
            )}
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
