const express = require("express")
const users = require("../database/db").users
const projects = require("../database/db").contributions
const pictures = require("../database/db").pictures

const { Helper } = require("../utils/index")
const { checkToken } = require("../middleware/checkToken")

const multer = require("multer")

const router = new express.Router()

// Handles binary files from front-end
const upload = multer()

// API from which we load our user profile
router.get("/", checkToken, (req, res) => {
    const { id } = req.decoded

    try{

        users
            .select("*")
            .from("users AS u")
            .innerJoin("user_profile AS up", "u.email", "up.email")
            .innerJoin("user_picture AS pic", "u.email", "pic.email")
            .where({ "u.user_id": id })
            .then(user => {
                res.json(user[0])
            })

    } catch (err) {
        res.status(500).send({message: "User data is not available"})
    }
})

// Route to get every connection that recorded to the logged user
router.get("/friends", checkToken, (req, res) => {
    const { id } = req.decoded

    try{
        users
            .select("friend_id", "fr.first_name", "fr.last_name")
            .from("users AS u")
            .innerJoin("connections AS c", "u.user_id", "c.user_id")
            .innerJoin("users AS fr", "fr.user_id", "c.friend_id")
            .where({"u.user_id": id})
            .then(user => {
                res.json(user)
            })
    } catch (err) {
        res.status(500).send({message: "User data is not available"})
    }
})

// Our logging in and registering API works with signed JWT's. This could be secured more in
// in the future using JWE or another technique.

// Login API
router.post("/login", (req, res) => {
    const { email, password } = req.body

    // Check if email and password are provided
    if (email && password) {
        // Check if the provided e-mail exist otherwise crashes on non-existing email
        try {
            users
                .select("email")
                .from("users")
                .where({ email: email })
                .then(data => {
                    if (data.length > 0) {
                        try {
                            users("user_login")
                                .where({ email: email })
                                .select()
                                .then(rows => {
                                    // Check if emails and passwords match
                                    if (
                                        email === rows[0].email &&
                                        Helper.comparePassword(
                                            rows[0].hashpass,
                                            password
                                        )
                                    ) {
                                        // Generate JWT and send it to the user.
                                        return users
                                            .select("*")
                                            .from("users")
                                            .innerJoin("user_profile", "users.email", "user_profile.email")
                                            .where({ "users.email": email })
                                            .then(user => {
                                                const {
                                                    publicToken,
                                                    privateToken,
                                                } = Helper.generateToken(
                                                    user[0].user_id
                                                )
                                                res.cookie(
                                                    "teambuildPublic",
                                                    publicToken
                                                )
                                                res.cookie(
                                                    "teambuildPrivate",
                                                    privateToken,
                                                    {
                                                        httpOnly: true,
                                                    }
                                                )
                                                res.json({
                                                    user: user[0],
                                                    message: "Login successful",
                                                })
                                            })
                                    } else {
                                        res.status(400).send({
                                            message:
                                                "Provided incorrect login details",
                                        })
                                    }
                                })
                        } catch (e) {
                            res.status(400).send({
                                message:
                                    "A problem occured when trying to load your account",
                            })
                        }
                    } else {
                        res.status(400).send({
                            message: "Provided incorrect login details",
                        })
                    }
                })
        } catch (e) {
            res.status(400).send({
                message: "Database is not available, please try again later",
            })
        }
    } else {
        res.status(400).send({
            message: "Please provide your E-mail and password",
        })
    }
})

// Register API
router.post("/register", (req, res) => {
    const { email, password, first_name, last_name, github, role } = req.body

    // Check if email and password are present
    if (!email || !password || !first_name || !last_name || !github || !role) {
        return res.status(400).send({
            message: "Email, password, first name, last name, github or role is missing.",
        })
    }

    // Check if email input is valid
    if (!Helper.isValidEmail(email)) {
        return res
            .status(400)
            .send({ message: "Incorrect email format has been given." })
    }

    // Hash input password
    const hashedPassword = Helper.hashPassword(password)

    // Insert user into "users" table with required empty fields if email not existing
    try {
        users
            .select("email")
            .from("users")
            .where({ email: email })
            .then(data => {
                if (data.length !== 0) {
                    return res
                        .status(400)
                        .send({ message: "Email already exist" })
                } else {
                    try {
                        users.transaction(trx => {
                            return (
                                trx
                                    .insert({
                                        email: email,
                                        first_name: first_name,
                                        last_name: last_name,
                                        joined: new Date(),
                                        isadmin: false,
                                    })
                                    // Insert user into "user_login" table with email and password input
                                    .into("users")
                                    .then(() =>
                                        trx("user_profile").insert({
                                            email: email,
                                            github: github,
                                            linkedin: null,
                                            website: null,
                                            location: null,
                                            role: role,
                                            skills: null,
                                            bio: null
                                        }).into("user_profile")
                                    )
                                    .then(() =>
                                        trx("user_login").insert({
                                            email: email,
                                            hashpass: hashedPassword,
                                        })
                                    )
                            )
                        })
                        res.json({
                            message: "Registration successful",
                        })
                    } catch (e) {
                        res.status(500).send({ message: "Database error" })
                    }
                }
            })
    } catch (e) {
        res.status(400).send({ message: "Incorrect details entered." })
    }
})

router.post("/join", checkToken, (req, res) => {
    /**
     When User added to a project, front end has to send the user's ID
     and the selected Project's ID.
    **/

    const { user, project } = req.body

    // Check if required datas are present
    if (!user || !project) {
        return res
            .status(400)
            .send({ message: "User ID or Project ID is missing" })
    }

    try {
        projects
            .select("*")
            .from("contribution")
            .where({
                user_id: user,
                project_id: project,
            })
            .then(data => {
                if (data.length !== 0) {
                    return res
                        .status(400)
                        .send({ message: "User already joined to the Project" })
                } else {
                    try {
                        projects.transaction(trx => {
                            return trx
                                .insert({
                                    user_id: user,
                                    project_id: project,
                                })
                                .into("contribution")
                        })
                        res.json({
                            message: "User successfully added to the project",
                        })
                    } catch (e) {
                        res.status(500).send({
                            message: "Cannot add new project",
                        })
                    }
                }
            })
    } catch (e) {
        res.status(400).send({ message: "Server is not available" })
    }
})

// Adding or updating user profile picture

router.post("/picture", checkToken, upload.single('file'), (req, res) => {

    // Insert user email and uploaded image into the DB
    const email = req.body.email
    const img = req.file

    // Check if image or email is missing
    if(!img || !email){
        res.json({message: "Email or picture missing"})
    } else {
        try{

            users
                .select("*")
                .from("user_picture")
                .where({email: email})
                .then(data => {
                    console.log('data', data)
                    if(data.length !== 0) {
                        // Replace an existing picture
                        try{

                            users.transaction(trx => {
                                return trx("user_picture")
                                    .where({email: email})
                                    .update({image: img})
                            })
                            res.json({message: "Image successfully updated"})

                        } catch(err) {
                            res.status(500).send({message: "Update error"})
                        }

                    } else {

                        try{

                            // Adding picture to database if there is no record yet with the user email
                            users.transaction(trx => {
                                return trx.insert({
                                    email: email,
                                    image: img
                                }).into("user_picture")
                            })
                            res.json({message: "Image successfully uploaded"})

                        } catch(err) {
                            res.status(500).send({message: "Upload error"})
                        }

                    }
                })

        } catch (err) {
            res.status(500).send({message: "Server error"})
        }
    }

})

module.exports = router
