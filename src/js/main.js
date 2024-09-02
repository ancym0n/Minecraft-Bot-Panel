(() => {
  const textArray = [
    "Loading...",
    "Doxxing you...",
    "Impersonating you...",
    "Wasting your time...",
    "Downloading a virus...",
    "Stealing your identity...",
    "Stealing your passwords...",
    "Reporting you to the FBI...",
    "Loading your private tokens...",
    "Stealing your passport details...",
    "Getting your private information...",
    "Getting your bank account details...",
  ];
  const randomIndex = Math.floor(Math.random() * textArray.length);
  const randomText = textArray[randomIndex];

  document.getElementById("randomText").innerText = randomText;
})();

window.onload = () => {
  setTimeout(() => {
    document.getElementById("loading").classList.add("loaded");
    setTimeout(() => {
      document.getElementById("loading").style.transform = "translateY(-100%)";
    }, 600);
  }, 1000);
};
